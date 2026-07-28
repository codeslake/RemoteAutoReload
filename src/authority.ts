/**
 * Reading the SSH host out of a remote authority.
 *
 * Its own module, with no VS Code import, so it can be tested directly: probing
 * the wrong host answers confidently about a machine we were not asked about,
 * which is worse than not answering at all.
 */

const SSH_PREFIX = 'ssh-remote+';

/** `ssh-remote+dev-box` -> `dev-box`. Any other remote kind yields undefined. */
export function hostFromAuthority(authority: string | undefined): string | undefined {
	if (!authority?.startsWith(SSH_PREFIX)) {
		return undefined;
	}
	// Hosts may themselves contain '+', so only the first separator is one.
	return authority.slice(SSH_PREFIX.length) || undefined;
}
