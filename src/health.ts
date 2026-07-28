/**
 * Reading a filesystem error as an answer about the connection.
 *
 * Its own module, with no VS Code import, so it can be tested directly. Getting
 * this backwards is the failure that hides itself: call every error 'healthy'
 * and the extension never fires, looking perfectly well-behaved while doing
 * nothing at all.
 */

import type { Health } from './supervisor';

/**
 * Codes that mean the channel answered.
 *
 * The extension host funnels every `workspace.fs` failure through
 * `FileSystemError`, so the class alone says nothing — only the code
 * distinguishes "the remote replied, and the reply was no" from "there was no
 * reply". These are replies: the file is gone, or is the wrong type, or we are
 * not allowed to look. Something on the far end had to form that opinion.
 */
const REPLIED = new Set(['FileNotFound', 'FileExists', 'FileNotADirectory', 'FileIsADirectory', 'NoPermissions']);

/**
 * Codes that mean the connection is gone.
 *
 * `Unavailable` is the headline case: the `vscode-remote://` provider is
 * unregistered, reported as ENOPRO and mapped here. `Unknown` is a call cut off
 * mid-flight. Both are what a window sitting on the "could not establish
 * connection" dialog produces.
 */
const GONE = new Set(['Unavailable', 'Unknown']);

/**
 * What a rejected `stat` says about the connection.
 *
 * Deliberately three-valued. A code we do not recognise is not evidence the link
 * is dead any more than it is evidence the link is fine, and guessing 'dead'
 * would reload a working window — the one outcome worse than doing nothing.
 */
export function healthFromError(code: string | undefined): Health {
	if (code === undefined) {
		return 'unknown';
	}
	if (REPLIED.has(code)) {
		return 'healthy';
	}
	return GONE.has(code) ? 'unhealthy' : 'unknown';
}
