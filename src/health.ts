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
 * What a rejected `stat` says about the connection.
 *
 * Anything not in REPLIED is read as unhealthy. A dropped connection arrives as
 * `Unavailable` (the `vscode-remote://` provider is unregistered, reported as
 * ENOPRO and mapped to Unavailable) or as `Unknown` (the channel was cancelled
 * mid-call). Unknown codes count against the connection on purpose:
 * a new code we have never seen is not evidence that the link is fine.
 */
export function healthFromError(code: string | undefined): Health {
	return code !== undefined && REPLIED.has(code) ? 'healthy' : 'unhealthy';
}
