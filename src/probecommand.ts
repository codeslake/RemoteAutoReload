/**
 * Building the reachability probe's command line.
 *
 * Its own module, with no VS Code import, so the quoting and the platform
 * differences can be tested directly.
 */

import type { SshTarget } from './authority';

export interface Probe {
	file: string;
	args: string[];
}

/** POSIX single-quoting: a quote inside is closed, escaped, and reopened. */
const quotePosix = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`;

/**
 * cmd.exe quoting, which has no escape for `"` inside a quoted string. Doubling
 * is the convention every tool on Windows settles on.
 */
const quoteWindows = (s: string) => `"${s.replaceAll('"', '""')}"`;

/**
 * The command that answers "does this host respond?".
 *
 * The default runs ssh directly, with no shell: there is nothing to quote and
 * nothing to go wrong. An override goes through a shell on purpose, since pipes
 * and redirection are the reason someone would write one.
 */
export function buildProbe(target: SshTarget, override: string, platform: NodeJS.Platform): Probe {
	if (override.trim()) {
		const windows = platform === 'win32';
		const quote = windows ? quoteWindows : quotePosix;
		// One pass, so a value that itself contains `${port}` is not rewritten by
		// the substitution that follows.
		const command = override.replace(/\$\{(host|port)\}/g, (_, key: string) =>
			quote(key === 'host' ? target.destination : String(target.port ?? 22)),
		);
		return windows ? { file: 'cmd.exe', args: ['/d', '/s', '/c', command] } : { file: '/bin/sh', args: ['-c', command] };
	}

	const args = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5'];
	if (target.port !== undefined) {
		args.push('-p', String(target.port));
	}
	// `--` so a destination starting with '-' cannot be read as a flag.
	args.push('--', target.destination, 'true');

	return { file: 'ssh', args };
}
