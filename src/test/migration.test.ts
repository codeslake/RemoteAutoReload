import { test } from 'node:test';
import assert from 'node:assert/strict';
import { removedSettingWarning } from '../migration';

/** The subset of ExtensionContext.globalState this needs, as a fake. */
function memento(initial: Record<string, unknown> = {}) {
	const store = { ...initial };
	return {
		get: <T>(key: string) => store[key] as T | undefined,
		update: async (key: string, value: unknown) => void (store[key] = value),
		shown: () => store,
	};
}

test('someone who had it switched off is told it no longer switches anything off', async () => {
	// Removing the setting silently re-armed auto-reload for exactly the people
	// who had opted out of it, and a CHANGELOG does not reach them.
	const w = await removedSettingWarning(false, memento());

	assert.ok(w);
	assert.match(w!, /remoteAutoReload\.enabled/, 'name the dead key');
	assert.match(w!, /Pause Watching/, 'and the thing to use instead');
});

test('it is said once per install, not once per reload', async () => {
	// This extension reloads windows for a living, and every reload reactivates
	// it. A flapping link would otherwise mean a notification per reload, with
	// no way to stop it: the setting is gone from the Settings UI too.
	const state = memento();

	assert.ok(await removedSettingWarning(false, state), 'first activation says it');
	assert.equal(await removedSettingWarning(false, state), undefined, 'later ones do not');
});

test('someone who had it explicitly on is not lectured', async () => {
	// The setting is gone either way, but nothing changed for them.
	assert.equal(await removedSettingWarning(true, memento()), undefined);
});

test('never set: nothing to say, and nothing recorded', async () => {
	const state = memento();

	assert.equal(await removedSettingWarning(undefined, state), undefined);
	assert.deepEqual(state.shown(), {}, 'a silent case must not burn the one-shot flag');
});
