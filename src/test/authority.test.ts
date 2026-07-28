import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hostFromAuthority } from '../authority';

test('the ssh host is the part after the scheme', () => {
	assert.equal(hostFromAuthority('ssh-remote+dev-box'), 'dev-box');
});

test('a host containing a plus keeps it: only the first separator is one', () => {
	assert.equal(hostFromAuthority('ssh-remote+odd+host'), 'odd+host');
});

test('other remote kinds are not ssh hosts', () => {
	for (const authority of ['dev-container+abc123', 'wsl+Ubuntu', 'attached-container+7f3a', 'tunnel+box']) {
		assert.equal(hostFromAuthority(authority), undefined, `${authority} must not be read as an ssh host`);
	}
});

test('a missing or malformed authority yields no host, rather than an empty one', () => {
	for (const authority of [undefined, '', 'ssh-remote+', 'ssh-remote', 'dev-box']) {
		assert.equal(hostFromAuthority(authority), undefined, `${String(authority)} must not produce a host`);
	}
});
