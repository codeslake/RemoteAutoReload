import { test } from 'node:test';
import assert from 'node:assert/strict';
import { healthFromError } from '../health';

test('a reply is a reply, even when the answer is no', () => {
	// The remote had to look and form an opinion, so the channel is alive.
	for (const code of ['FileNotFound', 'FileExists', 'FileNotADirectory', 'FileIsADirectory', 'NoPermissions']) {
		assert.equal(healthFromError(code), 'healthy', `${code} means the far end answered`);
	}
});

test('Unavailable is the disconnected case and must not read as healthy', () => {
	// The failure that hides itself: treat this as healthy and the extension
	// never fires, while looking perfectly well-behaved.
	assert.equal(healthFromError('Unavailable'), 'unhealthy');
});

test('a cancelled channel is the other disconnected shape', () => {
	// A call cut off mid-flight surfaces as Unknown rather than Unavailable.
	assert.equal(healthFromError('Unknown'), 'unhealthy');
});

test('an unrecognised or absent code decides nothing', () => {
	// Not evidence the link is dead any more than evidence it is fine, and
	// guessing 'dead' would reload a working window.
	for (const code of ['SomethingNew', 'WeirdCode', '', undefined]) {
		assert.equal(healthFromError(code), 'unknown', `${String(code)} must not decide either way`);
	}
});
