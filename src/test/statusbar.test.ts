import { test } from 'node:test';
import assert from 'node:assert/strict';
import { statusFor } from '../statusbar';
import type { State } from '../supervisor';

const HOST = 'dev-box';

test('a healthy window says nothing', () => {
	for (const state of [{ kind: 'healthy' }, { kind: 'starting' }] satisfies State[]) {
		assert.equal(statusFor(state, HOST).visible, false);
	}
});

test('a disconnected window says someone is on it, and that the dialog can be ignored', () => {
	// This is the only thing on screen telling the user that the modal error
	// dialog VS Code just raised does not need them to do anything.
	const s = statusFor({ kind: 'degraded', ticks: 3, everConnected: true }, HOST);

	assert.equal(s.visible, true);
	assert.match(s.text, /Reconnecting/, 'the label says what is happening, not just a number');
	assert.match(s.text, new RegExp(HOST));
	assert.match(s.tooltip, /reload itself/, 'the tooltip promises the reload');
	assert.match(s.tooltip, /dialog/, 'and says the dialog can be left alone');
});

test('the failed-check count reads as English, singular and plural', () => {
	assert.match(statusFor({ kind: 'degraded', ticks: 1, everConnected: true }, HOST).tooltip, /1 failed check\b/);
	assert.match(statusFor({ kind: 'degraded', ticks: 2, everConnected: true }, HOST).tooltip, /2 failed checks/);
});

test('a pending reload says so, so the window blink is not a surprise', () => {
	const s = statusFor({ kind: 'reloadPending' }, HOST);

	assert.equal(s.visible, true);
	assert.match(s.text, /Reloading/);
});

test('a paused window and a declined one are told apart', () => {
	const paused = statusFor({ kind: 'idle', reason: 'paused' }, HOST);
	const declined = statusFor({ kind: 'idle', reason: 'declined' }, HOST);

	assert.notEqual(paused.text, declined.text, 'the labels distinguish them');
	for (const s of [paused, declined]) {
		assert.equal(s.visible, true);
		assert.match(s.tooltip, /Resume Watching This Window/, 'both say how to undo it');
	}
});

test('every state names the host, so several windows are tellable apart', () => {
	const states: State[] = [
		{ kind: 'starting' },
		{ kind: 'healthy' },
		{ kind: 'degraded', ticks: 1, everConnected: true },
		{ kind: 'reloadPending' },
		{ kind: 'idle', reason: 'paused' },
		{ kind: 'idle', reason: 'declined' },
	];
	for (const state of states) {
		assert.match(statusFor(state, HOST).text, new RegExp(HOST), `${state.kind} names the host`);
	}
});
