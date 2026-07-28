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
import type { SshTarget } from './authority';

const SECTION = 'remoteAutoReload';

function settings() {
	const c = vscode.workspace.getConfiguration(SECTION);
	return {
		enabled: c.get<boolean>('enabled', true),
		pollIntervalMs: c.get<number>('pollIntervalMs', 5000),
		healthTimeoutMs: c.get<number>('healthTimeoutMs', 4000),
		hostProbeTimeoutMs: c.get<number>('hostProbeTimeoutMs', 8000),
		hostProbeCommand: c.get<string>('hostProbeCommand', ''),
		policy: {
			graceTicks: c.get<number>('graceTicks', 4),
			reloadWhenDirty: c.get<boolean>('reloadWhenDirty', false),
			promptBeforeReload: c.get<boolean>('promptBeforeReload', false),
		} satisfies Config,
	};
}

class Watcher {
	private state: State = INITIAL;
	private timer: NodeJS.Timeout | undefined;
	private disposed = false;

	constructor(
		private readonly target: SshTarget,
		private readonly log: vscode.LogOutputChannel,
		private readonly status: vscode.StatusBarItem,
	) {}

	start(): void {
		this.log.info(`Watching ${this.target.label}`);
		this.render();
		this.schedule(0);
	}

	dispose(): void {
		this.disposed = true;
		clearTimeout(this.timer);
	}

	/** Applies a user command and reports the resulting state. */
	command(command: Command): void {
		this.state = applyCommand(this.state, command);
		this.log.info(`${command} -> ${this.describe()}`);
		this.render();
	}

	/** Runs one tick now, out of band, and reschedules around it. */
	async checkNow(): Promise<void> {
		clearTimeout(this.timer);
		await this.run();
	}

	private schedule(delayMs: number): void {
		if (this.disposed) {
			return;
		}
		// Self-rescheduling rather than setInterval: a tick can outlast the poll
		// interval (both probes have their own timeouts), and two ticks reading
		// the same state would both decide to reload.
		this.timer = setTimeout(() => void this.run(), delayMs);
	}

	private async run(): Promise<void> {
		if (this.disposed) {
			return;
		}

		const config = settings();
		if (!config.enabled) {
			this.schedule(config.pollIntervalMs);
			return;
		}

		const before = this.state;
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
		if (outcome.note && (outcome.state.kind !== before.kind || outcome.action.kind !== 'none')) {
			this.log.info(outcome.note);
		} else if (outcome.note) {
			this.log.debug(outcome.note);
		}
		this.render();

		switch (outcome.action.kind) {
			case 'none':
				break;
			case 'reload':
				this.log.info('Reloading window');
				await vscode.commands.executeCommand('workbench.action.reloadWindow');
				break;
			case 'prompt':
				void this.ask(outcome.action.reason);
				break;
		}

		this.schedule(config.pollIntervalMs);
	}

	/**
	 * Asks rather than reloading. Deliberately non-modal and asked once: the
	 * original re-issued a reload every tick, so the confirmation dialog it
	 * triggered could not be dismissed and accepting it discarded unsaved work.
	 */
	private async ask(reason: 'dirty' | 'configured'): Promise<void> {
		const detail =
			reason === 'dirty'
				? 'Reloading would discard unsaved changes.'
				: 'Reload to reconnect.';
		const choice = await vscode.window.showWarningMessage(
			`${this.target.label} is reachable again, but this window is still disconnected. ${detail}`,
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
		this.command('decline');
	}

	private describe(): string {
		switch (this.state.kind) {
			case 'healthy':
				return 'connected';
			case 'degraded':
				return `disconnected (${this.state.ticks} failed checks)`;
			case 'reloadPending':
				return 'reload requested';
			case 'idle':
				return this.state.reason === 'paused' ? 'paused' : 'not reloading (declined)';
		}
	}

	private render(): void {
		const icon = {
			healthy: 'check',
			degraded: 'sync~spin',
			reloadPending: 'debug-restart',
			idle: 'debug-pause',
		}[this.state.kind];

		this.status.text = `$(${icon}) ${this.target.label}`;
		this.status.tooltip = `RemoteAutoReload: ${this.describe()}`;
		// Shown only when it has something to say, so a healthy window stays quiet.
		if (this.state.kind === 'healthy') {
			this.status.hide();
		} else {
			this.status.show();
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
		log.info(`Not a Remote-SSH window (remoteName: ${vscode.env.remoteName ?? 'local'}), standing by.`);
		return;
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
