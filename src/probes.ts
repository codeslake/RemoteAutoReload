/**
 * Turning VS Code and the shell into the three questions the policy asks.
 *
 * Kept apart from `supervisor.ts` so the policy stays testable without a window,
 * and apart from `extension.ts` so the wiring stays readable.
 */

import * as vscode from 'vscode';
import { execFile } from 'node:child_process';
import { hostFromAuthority } from './authority';

/** The SSH host of a Remote-SSH window, e.g. `dev-box` — or undefined if this is not one. */
export function sshHost(): string | undefined {
	if (vscode.env.remoteName !== 'ssh-remote') {
		return undefined;
	}
	// There is no public API for the remote authority, but a remote window's
	// folders carry it: `vscode-remote://ssh-remote+<host>/path`.
	return hostFromAuthority(vscode.workspace.workspaceFolders?.[0]?.uri.authority);
}

/** A remote path guaranteed to exist, used only to make the connection answer. */
function probeTarget(): vscode.Uri | undefined {
	const folder = vscode.workspace.workspaceFolders?.[0]?.uri;
	return folder?.scheme === 'vscode-remote' ? folder : undefined;
}

/**
 * Round-trips this window's own remote channel.
 *
 * `workspace.fs` travels the exact connection VS Code uses, so the answer is
 * about this window by construction. That is the whole reason not to identify
 * an ssh process: a pid has to be guessed, and guessing picks another window's
 * tunnel when several are open to the same host.
 *
 * A disconnected channel does not fail fast, it simply never answers, so the
 * timeout is what turns silence into an answer.
 */
export async function checkHealth(timeoutMs: number): Promise<'healthy' | 'unhealthy'> {
	const target = probeTarget();
	if (!target) {
		return 'unhealthy';
	}

	const timeout = new Promise<'unhealthy'>(resolve => setTimeout(() => resolve('unhealthy'), timeoutMs));
	const stat = vscode.workspace.fs.stat(target).then(
		() => 'healthy' as const,
		// A reachable channel that says "no such file" is still a reachable channel.
		(err: unknown) => (err instanceof vscode.FileSystemError ? 'healthy' : 'unhealthy'),
	);

	return Promise.race([stat, timeout]);
}

/** Runs a command, resolving to its success rather than throwing on failure. */
function succeeds(file: string, args: string[], timeoutMs: number): Promise<boolean> {
	return new Promise(resolve => {
		const child = execFile(file, args, { timeout: timeoutMs, killSignal: 'SIGKILL' }, err => resolve(!err));
		child.on('error', () => resolve(false));
	});
}

/**
 * Whether the SSH host answers right now.
 *
 * Asked before reloading because VS Code turns a failed first resolve into a
 * fatal error with no retry, so a reload into an unreachable host converts a
 * window that would have recovered into one that cannot.
 */
export function checkHostReachable(host: string, timeoutMs: number, override: string): Promise<boolean> {
	if (override.trim()) {
		// The user's own machine-scoped command. A shell is what makes pipes and
		// redirection work, which is the point of the escape hatch; the host is
		// single-quoted so a hostname cannot end the quoting.
		const command = override.replaceAll('${host}', `'${host.replaceAll("'", `'\\''`)}'`);
		return succeeds('/bin/sh', ['-c', command], timeoutMs);
	}

	return succeeds(
		'ssh',
		['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', '--', host, 'true'],
		timeoutMs,
	);
}

/** Whether any editor holds unsaved changes, including ones not currently visible. */
export function isDirty(): boolean {
	return (
		vscode.workspace.textDocuments.some(d => d.isDirty) ||
		vscode.window.tabGroups.all.some(group => group.tabs.some(tab => tab.isDirty))
	);
}
