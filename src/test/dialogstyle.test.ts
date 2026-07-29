import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nativeDialogWarning } from '../dialogstyle';

test('native dialogs earn a warning: a reload cannot clear them', () => {
	// Measured: with the default "native", Remote-SSH's connection-error dialog is
	// an OS window. Reloading the window reconnects underneath it and the error
	// stays on screen, so the reload looks like it did nothing.
	const w = nativeDialogWarning('native');
	assert.ok(w, 'the default needs saying out loud');
	assert.match(w!, /window\.dialogStyle/, 'name the setting so the message is actionable');
	assert.match(w!, /custom/, 'and the value that fixes it');
});

test('custom dialogs are silent: nothing to warn about', () => {
	assert.equal(nativeDialogWarning('custom'), undefined);
});

test('an unset or unrecognised value is treated as the native default', () => {
	// VS Code's own default is "native", so anything not explicitly "custom"
	// behaves that way and deserves the same warning.
	for (const value of [undefined, '', 'Native', 'something-else']) {
		assert.ok(nativeDialogWarning(value), `${String(value)} behaves as native`);
	}
});
