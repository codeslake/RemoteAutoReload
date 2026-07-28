import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sshTargetFromAuthority, type SshTarget } from '../authority';

/** Builds the hex form Remote-SSH uses, the same way it does. */
const hex = (obj: object) => Buffer.from(JSON.stringify(obj), 'utf8').toString('hex');

test('a plain lowercase host is carried in the authority as-is', () => {
	assert.deepEqual(sshTargetFromAuthority('ssh-remote+dev-box'), {
		destination: 'dev-box',
		label: 'dev-box',
	} satisfies SshTarget);
});

test('an uppercase host is hex-encoded JSON, not a hostname', () => {
	// Remote-SSH encodes whenever the host has uppercase, a user, a port, or / \ + —
	// reading the hex as a hostname would probe a machine that does not exist, so
	// the probe could never succeed and the window would never be reloaded.
	assert.deepEqual(sshTargetFromAuthority(`ssh-remote+${hex({ hostName: 'MyServer' })}`), {
		destination: 'MyServer',
		label: 'MyServer',
	} satisfies SshTarget);
});

test('a user is part of the ssh destination', () => {
	assert.deepEqual(sshTargetFromAuthority(`ssh-remote+${hex({ hostName: 'box', user: 'jun' })}`), {
		destination: 'jun@box',
		label: 'jun@box',
	} satisfies SshTarget);
});

test('a port is carried separately, since ssh takes it as a flag', () => {
	assert.deepEqual(sshTargetFromAuthority(`ssh-remote+${hex({ hostName: 'box', user: 'jun', port: 2222 })}`), {
		destination: 'jun@box',
		label: 'jun@box:2222',
		port: 2222,
	} satisfies SshTarget);
});

test('a host containing a plus survives: it is why the encoding exists', () => {
	assert.deepEqual(sshTargetFromAuthority(`ssh-remote+${hex({ hostName: 'odd+host' })}`), {
		destination: 'odd+host',
		label: 'odd+host',
	} satisfies SshTarget);
});

test('other remote kinds are not ssh targets', () => {
	for (const authority of ['dev-container+abc123', 'wsl+Ubuntu', 'attached-container+7f3a', 'tunnel+box']) {
		assert.equal(sshTargetFromAuthority(authority), undefined, `${authority} must not be read as an ssh host`);
	}
});

test('a missing or malformed authority yields no target, rather than a broken one', () => {
	for (const authority of [undefined, '', 'ssh-remote+', 'ssh-remote']) {
		assert.equal(sshTargetFromAuthority(authority), undefined, `${String(authority)} must not produce a target`);
	}
});

test('hex that is not a host descriptor is refused rather than guessed at', () => {
	// Silence beats probing something invented: a wrong host answers confidently
	// about a machine nobody asked about.
	for (const bad of [
		Buffer.from('not json', 'utf8').toString('hex'),
		hex({ nothing: 'useful' }),
		hex(['array']),
		hex({ hostName: '' }),
	]) {
		assert.equal(sshTargetFromAuthority(`ssh-remote+${bad}`), undefined, `${bad} must not produce a target`);
	}
});

test('an odd-length or non-hex blob is treated as a literal hostname', () => {
	// Only even-length hex could be an encoding, so anything else is a name.
	assert.deepEqual(sshTargetFromAuthority('ssh-remote+abc'), {
		destination: 'abc',
		label: 'abc',
	} satisfies SshTarget);
});
