/**
 * Wiring: the policy in `supervisor.ts`, the probes in `probes.ts`, and the
 * window they act on.
 *
 * The one rule this file exists to keep: activation must never throw. The
 * original extension gave up here when its startup lookup failed, which is
 * exactly the disconnected state it was installed to fix, so it was reliably
 * absent whenever it was needed.
 */

import * as vscode from 'vscode';
import { INITIAL, applyCommand, tick, type Command, type Config, type State } from './supervisor';
import { checkHealth, checkHostReachable, isDirty, sshTarget } from './probes';
import { Loop } from './loop';
import { nativeDialogWarning } from './dialogstyle';
import { statusFor } from './statusbar';
import type { SshTarget } from './authority';

const SECTION = 'remoteAutoReload';

function settings() {
	const c = vscode.workspace.getConfiguration(SECTION);
	return {
		enabled: c.get<boolean>('enabled', true),
		pollIntervalMs: c.get<number>('pollIntervalMs', 5000),
		healthTimeoutMs: c.get<number>('healthTimeoutMs', 10_000),
		hostProbeTimeoutMs: c.get<number>('hostProbeTimeoutMs', 8000),
		hostProbeCommand: c.get<string>('hostProbeCommand', ''),
		policy: {
			graceTicks: c.get<number>('graceTicks', 12),
			reloadWhenDirty: c.get<boolean>('reloadWhenDirty', false),
			promptBeforeReload: c.get<boolean>('promptBeforeReload', false),
		} satisfies Config,
	};
}

class Watcher {
	private state: State = INITIAL;
	private lastNote: string | undefined;
	private disposed = false;
	private readonly loop: Loop;

	constructor(
		private readonly target: SshTarget,
		private readonly log: vscode.LogOutputChannel,
		private readonly status: vscode.StatusBarItem,
	) {
		this.loop = new Loop({
			run: () => this.run(),
			delayMs: () => settings().pollIntervalMs,
			// An unexpected failure is reported and the loop carries on. Going
			// quiet here would look exactly like a healthy window.
			onError: err => this.log.error(`Check failed: ${String(err)}`),
			setTimeout: (fn, ms) => setTimeout(fn, ms),
			clearTimeout: handle => clearTimeout(handle as NodeJS.Timeout),
		});
	}

	start(): void {
		this.log.info(`Watching ${this.target.label}`);
		this.render();
		this.loop.start();
	}

	dispose(): void {
		this.disposed = true;
		this.loop.stop();
	}

	/** Applies a user command and reports the resulting state. */
	command(command: Command): void {
		this.state = applyCommand(this.state, command);
		this.log.info(`${command} -> ${this.state.kind}`);
		this.render();
	}

	/** Runs one tick now, out of band, joining one already under way. */
	checkNow(): Promise<void> {
		return this.loop.runNow();
	}

	private async run(): Promise<void> {
		if (this.disposed) {
			return;
		}

		const config = settings();
		if (!config.enabled) {
			return;
		}

		const outcome = await tick(
			this.state,
			{
				health: () => checkHealth(config.healthTimeoutMs),
				hostReachable: () =>
					checkHostReachable(this.target, config.hostProbeTimeoutMs, config.hostProbeCommand),
				isDirty,
			},
			config.policy,
		);

		if (this.disposed) {
			return;
		}

		this.state = outcome.state;
		// Log a note the first time it is said, then stay quiet while it repeats.
		// Keying on the note rather than the state kind is what makes an outage
		// visibly count up: a window stuck at "unhealthy 1/13" reads as a dead
		// watcher, which is the impression this extension least wants to give.
		if (outcome.note && outcome.note !== this.lastNote) {
			this.log.info(outcome.note);
		} else if (outcome.note) {
			this.log.debug(outcome.note);
		}
		this.lastNote = outcome.note;
		this.render();

		switch (outcome.action.kind) {
			case 'none':
				break;
			case 'reload':
				this.log.info('Reloading window');
				await vscode.commands.executeCommand('workbench.action.reloadWindow');
				break;
			case 'prompt':
				this.ask(outcome.action.reason).catch(err => this.log.error(`Prompt failed: ${String(err)}`));
				break;
		}
	}

	/**
	 * Asks rather than reloading. Deliberately non-modal and asked once: the
	 * original re-issued a reload every tick, so the confirmation dialog it
	 * triggered could not be dismissed and accepting it discarded unsaved work.
	 */
	private async ask(reason: 'dirty' | 'configured'): Promise<void> {
		const detail =
			reason === 'dirty'
				? 'Reloading is the way back, but this window has unsaved changes and reloading discards them.'
				: 'Reloading will reconnect it.';
		const choice = await vscode.window.showWarningMessage(
			`RemoteAutoReload: ${this.target.label} is reachable again, but this window is still disconnected. ${detail}`,
			'Reload Window',
			'Save All and Reload',
			'Not Now',
		);

		if (this.disposed) {
			return;
		}

		if (choice === 'Save All and Reload') {
			await vscode.workspace.saveAll();
		}
		if (choice === 'Reload Window' || choice === 'Save All and Reload') {
			await vscode.commands.executeCommand('workbench.action.reloadWindow');
			return;
		}

		// Dismissing counts as declining: a half-dead link recovers intermittently,
		// and a window whose owner said no must not be asked again on every blip.
		// But only while the question still stands — the connection may have come
		// back while the notification sat there, and dismissing a stale prompt
		// must not switch off a window that is working.
		if (this.state.kind === 'reloadPending') {
			this.command('decline');
		}
	}

	private render(): void {
		const s = statusFor(this.state, this.target.label);
		this.status.text = s.text;
		this.status.tooltip = s.tooltip;
		// Quiet while healthy: a status item that is always there stops being read.
		if (s.visible) {
			this.status.show();
		} else {
			this.status.hide();
		}
	}
}

export function activate(context: vscode.ExtensionContext): void {
	const log = vscode.window.createOutputChannel('RemoteAutoReload', { log: true });
	context.subscriptions.push(log);

	context.subscriptions.push(
		vscode.commands.registerCommand(`${SECTION}.showLog`, () => log.show()),
	);

	const target = sshTarget();
	if (!target) {
		// Distinguished so a field report is not sent chasing the wrong thing: a
		// remote window with no remote folder has no URI to probe, which is a
		// different situation from a local window.
		log.info(
			vscode.env.remoteName === 'ssh-remote'
				? 'Remote-SSH window with no remote folder open; there is nothing to probe.'
				: `Not a Remote-SSH window (remoteName: ${vscode.env.remoteName ?? 'local'}), standing by.`,
		);
		return;
	}

	// The one setting this extension cannot work around. Said once at startup,
	// in the log rather than a notification: the point is to explain a leftover
	// dialog when someone goes looking, not to nag on every window.
	const warning = nativeDialogWarning(
		vscode.workspace.getConfiguration('window').get<string>('dialogStyle'),
	);
	if (warning) {
		log.warn(warning);
	}

	const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
	status.command = `${SECTION}.showLog`;
	const watcher = new Watcher(target, log, status);
	context.subscriptions.push(status, { dispose: () => watcher.dispose() });

	context.subscriptions.push(
		vscode.commands.registerCommand(`${SECTION}.checkNow`, () => watcher.checkNow()),
		vscode.commands.registerCommand(`${SECTION}.reloadNow`, () =>
			vscode.commands.executeCommand('workbench.action.reloadWindow'),
		),
		vscode.commands.registerCommand(`${SECTION}.pause`, () => watcher.command('pause')),
		vscode.commands.registerCommand(`${SECTION}.resume`, () => watcher.command('resume')),
	);

	watcher.start();
}

export function deactivate(): void {
	// Everything is registered on context.subscriptions.
}
