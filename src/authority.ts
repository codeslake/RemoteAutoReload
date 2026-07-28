/**
 * Reading the SSH target out of a remote authority.
 *
 * Its own module, with no VS Code import, so it can be tested directly: probing
 * the wrong host answers confidently about a machine we were not asked about,
 * which is worse than not answering at all.
 */

const SSH_PREFIX = 'ssh-remote+';

export interface SshTarget {
	/** What to hand ssh, e.g. `jun@box`. */
	destination: string;
	/** What to show a person, which includes the port when there is one. */
	label: string;
	/** ssh takes the port as a flag, not as part of the destination. */
	port?: number;
}

/**
 * Remote-SSH keeps the hostname in the authority verbatim only when it is a
 * plain lowercase name with no user, no port, and none of `/ \ +`. Otherwise it
 * hex-encodes a JSON descriptor, because those characters cannot survive in an
 * authority. Reading that hex as a hostname yields a machine that does not
 * exist, so the reachability probe could never succeed and the window would
 * never be reloaded — a silent, total failure for anyone connecting as
 * `user@host`, on a port, or to a host with a capital letter.
 */
function decodeDescriptor(encoded: string): SshTarget | undefined {
	if (encoded.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(encoded)) {
		return undefined;
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(Buffer.from(encoded, 'hex').toString('utf8'));
	} catch {
		return undefined;
	}

	if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
		return undefined;
	}

	const { hostName, user, port } = parsed as { hostName?: unknown; user?: unknown; port?: unknown };
	if (typeof hostName !== 'string' || !hostName) {
		return undefined;
	}

	const destination = typeof user === 'string' && user ? `${user}@${hostName}` : hostName;
	return typeof port === 'number'
		? { destination, label: `${destination}:${port}`, port }
		: { destination, label: destination };
}

/** `ssh-remote+dev-box` -> that host. Any other remote kind yields undefined. */
export function sshTargetFromAuthority(authority: string | undefined): SshTarget | undefined {
	if (!authority?.startsWith(SSH_PREFIX)) {
		return undefined;
	}

	// Hosts may themselves contain '+', so only the first separator is one.
	const rest = authority.slice(SSH_PREFIX.length);
	if (!rest) {
		return undefined;
	}

	const decoded = decodeDescriptor(rest);
	if (decoded) {
		return decoded;
	}

	// Hex that does not decode to a host descriptor is refused rather than
	// guessed at, but a name that merely looks hex-ish is still a name.
	return /^[0-9a-f]+$/i.test(rest) && rest.length % 2 === 0 ? undefined : { destination: rest, label: rest };
}
