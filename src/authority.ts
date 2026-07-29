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
	// The encoding is always the hex of a JSON object, so it always begins with
	// the hex of '{'. Requiring that keeps ordinary hex-looking hostnames —
	// `cafe`, `deadbeef`, `1234` — from being mistaken for an encoding and
	// refused, which would leave their owners with an inert extension.
	if (!/^7b(?:[0-9a-f]{2})+$/i.test(encoded)) {
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

/** `ssh-remote+myhost` -> that host. Any other remote kind yields undefined. */
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

	// Something that opens like an encoding but does not decode is refused rather
	// than guessed at: probing an invented host answers confidently about a
	// machine nobody asked about. Anything else is a plain hostname.
	return /^7b(?:[0-9a-f]{2})+$/i.test(rest) ? undefined : { destination: rest, label: rest };
}
