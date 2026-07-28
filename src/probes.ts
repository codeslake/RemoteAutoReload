/**
 * Turning VS Code and the shell into the three questions the policy asks.
 *
 * Kept apart from `supervisor.ts` so the policy stays testable without a window,
 * and apart from `extension.ts` so the wiring stays readable.
 */

import * as vscode from 'vscode';
import { execFile } from 'node:child_process';
import { sshTargetFromAuthority, type SshTarget } from './authority';
import { healthFromError } from './health';
import type { Health } from './supervisor';

/** The SSH target of a Remote-SSH window — or undefined if this is not one. */
export function sshTarget(): SshTarget | undefined {
	if (vscode.env.remoteName !== 'ssh-remote') {
		return undefined;
	}
	// There is no public API for the remote authority, but a remote window's
	// folders carry it: `vscode-remote://ssh-remote+<host>/path`.
	return sshTargetFromAuthority(vscode.workspace.workspaceFolders?.[0]?.uri.authority);
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
export async function checkHealth(timeoutMs: number): Promise<Health> {
	const target = probeTarget();
	if (!target) {
		return 'unhealthy';
	}

	let timer: NodeJS.Timeout | undefined;
	const timeout = new Promise<Health>(resolve => {
		timer = setTimeout(() => resolve('unhealthy'), timeoutMs);
	});

	const stat = Promise.resolve(vscode.workspace.fs.stat(target)).then(
		() => 'healthy' as const,
		// Every workspace.fs failure arrives as a FileSystemError, so the class
		// says nothing; only the code separates a reply from silence.
		(err: unknown) => healthFromError(err instanceof vscode.FileSystemError ? err.code : undefined),
	);

	try {
		return await Promise.race([stat, timeout]);
	} finally {
		clearTimeout(timer);
	}
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
export function checkHostReachable(target: SshTarget, timeoutMs: number, override: string): Promise<boolean> {
	if (override.trim()) {
		// The user's own machine-scoped command. A shell is what makes pipes and
		// redirection work, which is the point of the escape hatch; the host is
		// single-quoted so a hostname cannot end the quoting.
		const quote = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`;
		const command = override
			.replaceAll('${host}', quote(target.destination))
			.replaceAll('${port}', quote(String(target.port ?? 22)));
		return succeeds('/bin/sh', ['-c', command], timeoutMs);
	}

	const args = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5'];
	if (target.port !== undefined) {
		args.push('-p', String(target.port));
	}
	// `--` so a destination starting with '-' cannot be read as a flag.
	args.push('--', target.destination, 'true');

	return succeeds('ssh', args, timeoutMs);
}

/** Whether any editor holds unsaved changes, including ones not currently visible. */
export function isDirty(): boolean {
	return (
		vscode.workspace.textDocuments.some(d => d.isDirty) ||
		vscode.window.tabGroups.all.some(group => group.tabs.some(tab => tab.isDirty))
	);
}
