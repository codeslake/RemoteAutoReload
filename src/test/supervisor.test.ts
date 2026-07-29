import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	INITIAL,
	applyCommand,
	tick,
	type Action,
	type Config,
	type Health,
	type Probes,
	type State,
} from '../supervisor';

const CONFIG: Config = {
	graceTicks: 4,
	reloadWhenDirty: false,
	promptBeforeReload: false,
};

type ProbeOverrides = {
	health: Health | (() => Promise<Health>);
	hostReachable: boolean | (() => Promise<boolean>);
	dirty: boolean;
};

function probes(over: Partial<ProbeOverrides> = {}): Probes {
	const { health = 'healthy', hostReachable = true, dirty = false } = over;
	return {
		health: typeof health === 'function' ? health : async () => health,
		hostReachable: typeof hostReachable === 'function' ? hostReachable : async () => hostReachable,
		isDirty: () => dirty,
	};
}

/** Counts how often each probe is called, so ordering guarantees can be asserted. */
function countingProbes(over: Partial<ProbeOverrides> = {}) {
	const inner = probes(over);
	const calls = { health: 0, hostReachable: 0, isDirty: 0 };
	const counted: Probes = {
		health: () => (calls.health++, inner.health()),
		hostReachable: () => (calls.hostReachable++, inner.hostReachable()),
		isDirty: () => (calls.isDirty++, inner.isDirty()),
	};
	return { probes: counted, calls };
}

/** Runs `count` ticks against unchanging probes, returning every action taken. */
async function run(
	from: State,
	p: Probes,
	count: number,
	config: Config = CONFIG,
): Promise<{ state: State; actions: Action[] }> {
	let state = from;
	const actions: Action[] = [];
	for (let i = 0; i < count; i++) {
		const out = await tick(state, p, config);
		state = out.state;
		actions.push(out.action);
	}
	return { state, actions };
}

/** A window that has answered at least once, which is the ordinary case. */
const CONNECTED: State = { kind: 'healthy' };

const reloads = (actions: Action[]) => actions.filter(a => a.kind === 'reload');
const prompts = (actions: Action[]) => actions.filter(a => a.kind === 'prompt');

test('a healthy window is left alone and never probes the host', async () => {
	const { probes: p, calls } = countingProbes({ health: 'healthy' });

	const { state, actions } = await run(CONNECTED, p, 10);

	assert.deepEqual(state, CONNECTED);
	assert.deepEqual(actions.map(a => a.kind), Array(10).fill('none'));
	assert.equal(calls.hostReachable, 0, 'a healthy window must not spawn an ssh probe');
});

test('a brief outage does not reload: the window is given the grace period to heal itself', async () => {
	const { probes: p, calls } = countingProbes({ health: 'unhealthy' });

	const { state, actions } = await run(CONNECTED, p, CONFIG.graceTicks - 1);

	assert.deepEqual(actions.map(a => a.kind), Array(CONFIG.graceTicks - 1).fill('none'));
	assert.deepEqual(state, { kind: 'degraded', ticks: CONFIG.graceTicks - 1, everConnected: true } satisfies State);
	assert.equal(calls.hostReachable, 0, 'the host is not probed until the grace period is spent');
});

test('a window that never connected does not wait out the grace period', async () => {
	// A window whose FIRST resolve failed is the case this extension exists for:
	// VS Code turns that failure into a fatal error and never retries, so the
	// grace period buys nothing and costs everything — the modal error dialog
	// appears about 32s in, and waiting ~60s guarantees the user sees it.
	const { state, actions } = await run(INITIAL, probes({ health: 'unhealthy' }), 2);

	assert.equal(actions[0]?.kind, 'reload', 'reload on the first observation, before the dialog can appear');
	assert.deepEqual(state, { kind: 'reloadPending' } satisfies State);
});

test('a window that was connected still waits: that outage may heal itself', async () => {
	// Reached healthy first, so VS Code owns the reconnect and is good at it.
	const connected = await run(INITIAL, probes({ health: 'healthy' }), 1);
	const { actions } = await run(connected.state, probes({ health: 'unhealthy' }), CONFIG.graceTicks);

	assert.deepEqual(actions.map(a => a.kind), Array(CONFIG.graceTicks).fill('none'));
});

test('an outage that outlives the grace period reloads, once the host answers', async () => {
	// graceTicks observations are spent waiting; the reload comes on the next one.
	const { state, actions } = await run(CONNECTED, probes({ health: 'unhealthy' }), CONFIG.graceTicks + 1);

	assert.deepEqual(actions.map(a => a.kind), [...Array(CONFIG.graceTicks).fill('none'), 'reload']);
	assert.deepEqual(state, { kind: 'reloadPending' } satisfies State);
});

test('the reload is requested exactly once, however long the outage lasts', async () => {
	// The regression test for the defect this rewrite exists for: the original
	// re-issued the reload every tick, so a reload VS Code refused (unsaved
	// changes) became a dialog the user could not dismiss.
	const { actions } = await run(INITIAL, probes({ health: 'unhealthy' }), 100);

	assert.equal(reloads(actions).length, 1);
});

test('an unreachable host is never reloaded into: the one non-retried resolve is not spent on a doomed attempt', async () => {
	const { state, actions } = await run(INITIAL, probes({ health: 'unhealthy', hostReachable: false }), 20);

	assert.equal(reloads(actions).length, 0);
	assert.equal(state.kind, 'degraded', 'stays degraded so it can reload as soon as the host returns');
});

test('the reload happens on the tick the host comes back', async () => {
	let reachable = false;
	const p = probes({ health: 'unhealthy', hostReachable: async () => reachable });

	const waiting = await run(INITIAL, p, 20);
	assert.equal(reloads(waiting.actions).length, 0);

	reachable = true;
	const out = await tick(waiting.state, p, CONFIG);

	assert.equal(out.action.kind, 'reload');
});

test('unsaved work is never discarded: a dirty window is asked, not reloaded', async () => {
	const { state, actions } = await run(INITIAL, probes({ health: 'unhealthy', dirty: true }), 20);

	assert.equal(reloads(actions).length, 0);
	assert.deepEqual(prompts(actions), [{ kind: 'prompt', reason: 'dirty' }]);
	assert.equal(state.kind, 'reloadPending', 'asking is terminal too, so the prompt is raised once');
});

test('promptBeforeReload asks even with nothing unsaved', async () => {
	const config: Config = { ...CONFIG, promptBeforeReload: true };

	const { actions } = await run(INITIAL, probes({ health: 'unhealthy' }), 20, config);

	assert.deepEqual(prompts(actions), [{ kind: 'prompt', reason: 'configured' }]);
});

test('unsaved work outranks promptBeforeReload in the reason given', async () => {
	const config: Config = { ...CONFIG, promptBeforeReload: true };

	const { actions } = await run(INITIAL, probes({ health: 'unhealthy', dirty: true }), 20, config);

	assert.deepEqual(prompts(actions), [{ kind: 'prompt', reason: 'dirty' }]);
});

test('reloadWhenDirty opts out of the safety net', async () => {
	const config: Config = { ...CONFIG, reloadWhenDirty: true };

	const { actions } = await run(INITIAL, probes({ health: 'unhealthy', dirty: true }), 20, config);

	assert.equal(reloads(actions).length, 1);
});

test('a window that heals itself is not reloaded, however long it was degraded', async () => {
	let health: Health = 'unhealthy';
	const p = probes({ health: async () => health });

	// Far past the grace period, but recovering before the host answers.
	const degraded = await run(CONNECTED, probes({ health: 'unhealthy', hostReachable: false }), 50);
	health = 'healthy';
	const { state, actions } = await run(degraded.state, p, 5);

	assert.equal(reloads(actions).length, 0);
	assert.deepEqual(state, { kind: 'healthy' } satisfies State);
});

test('a healed window degrades from scratch: the old outage does not count toward the new one', async () => {
	const degraded = await run(CONNECTED, probes({ health: 'unhealthy', hostReachable: false }), CONFIG.graceTicks - 1);
	const recovered = await run(degraded.state, probes({ health: 'healthy' }), 1);

	const { actions } = await run(recovered.state, probes({ health: 'unhealthy' }), 1);

	assert.equal(actions[0]?.kind, 'none', 'the earlier outage must not carry over and trigger immediately');
});

test('a window that reconnects while a reload is pending is watched again from a clean slate', async () => {
	const pending: State = { kind: 'reloadPending' };

	const { state } = await run(pending, probes({ health: 'healthy' }), 1);

	assert.deepEqual(state, { kind: 'healthy' } satisfies State);
});

test('a flapping connection does not re-ask after the user declines', async () => {
	// The half-dead channel that answers intermittently is exactly what this
	// extension is for, so recovery must not silently re-arm a declined window.
	let health: Health = 'unhealthy';
	const p = probes({ health: async () => health, dirty: true });

	const asked = await run(INITIAL, p, 20);
	assert.equal(prompts(asked.actions).length, 1);
	const declined = applyCommand(asked.state, 'decline');

	let state = declined;
	const actions: Action[] = [];
	for (let cycle = 0; cycle < 5; cycle++) {
		health = 'healthy';
		const up = await run(state, p, 3);
		health = 'unhealthy';
		const down = await run(up.state, p, 20);
		state = down.state;
		actions.push(...up.actions, ...down.actions);
	}

	assert.equal(prompts(actions).length, 0, 'declining must hold across recovery, not just within one outage');
	assert.equal(reloads(actions).length, 0);
});

test('a paused window is not watched at all', async () => {
	const { probes: p, calls } = countingProbes({ health: 'unhealthy' });
	const paused = applyCommand(INITIAL, 'pause');

	const { state, actions } = await run(paused, p, 20);

	assert.deepEqual(actions.map(a => a.kind), Array(20).fill('none'));
	assert.equal(state.kind, 'idle');
	assert.equal(calls.health, 0, 'a paused window must not probe anything');
});

test('resuming re-arms a declined or paused window', async () => {
	for (const reason of ['decline', 'pause'] as const) {
		const idle = applyCommand(INITIAL, reason);
		const resumed = applyCommand(idle, 'resume');

		assert.deepEqual(resumed, INITIAL, `${reason} must be undone by resume`);

		const { actions } = await run(resumed, probes({ health: 'unhealthy' }), 20);
		assert.equal(reloads(actions).length, 1, `${reason} then resume must watch the window again`);
	}
});

test('a slow remote is not a gone remote: unknown holds the state', async () => {
	// A loaded remote goes briefly unresponsive; VS Code says so in its own log.
	// Counting that as a disconnect reloads windows that were working, which is
	// what this extension exists to avoid doing.
	const degraded = await run(INITIAL, probes({ health: 'unhealthy', hostReachable: false }), 2);
	const { state, actions } = await run(degraded.state, probes({ health: 'unknown' }), 50);

	assert.deepEqual(actions.map(a => a.kind), Array(50).fill('none'));
	assert.deepEqual(state, degraded.state, 'no progress toward a reload, and no reset either');
});

test('a remote that stutters every couple of minutes is left alone', async () => {
	// Taken from a real night of logs: a loaded remote's extension host went
	// briefly unresponsive on a ~2-minute cycle (VS Code says so in its own log),
	// the probe timed out each time, and three working windows were reloaded.
	// Measured: ~14-38s unresponsive, ~75-120s apart.
	const STUTTER_TICKS = Math.ceil(38_000 / 5_000); // the longest stall seen
	const CALM_TICKS = Math.ceil(75_000 / 5_000);

	let state: State = CONNECTED;
	const actions: Action[] = [];
	for (let cycle = 0; cycle < 20; cycle++) {
		for (const [health, count] of [
			['unknown', STUTTER_TICKS],
			['healthy', CALM_TICKS],
		] as const) {
			const out = await run(state, probes({ health }), count);
			state = out.state;
			actions.push(...out.actions);
		}
	}

	assert.equal(reloads(actions).length, 0, 'a stuttering remote must never be reloaded');
	assert.equal(prompts(actions).length, 0);
	assert.deepEqual(state, CONNECTED);
});

test('a healthy window that goes slow is not marched toward a reload', async () => {
	const { state, actions } = await run(CONNECTED, probes({ health: 'unknown' }), 50);

	assert.equal(reloads(actions).length, 0);
	assert.deepEqual(state, CONNECTED, 'no answer changes nothing');
});

test('a health probe that fails is not evidence either way: the window holds its state', async () => {
	const failing = probes({ health: async () => { throw new Error('lsof exploded'); } });

	const degraded = await run(INITIAL, probes({ health: 'unhealthy', hostReachable: false }), 2);
	const { state, actions } = await run(degraded.state, failing, 50);

	assert.deepEqual(actions.map(a => a.kind), Array(50).fill('none'));
	assert.deepEqual(
		state,
		degraded.state,
		'a broken probe must neither advance toward a reload nor clear a real outage',
	);
});

test('a host probe that fails counts as unreachable, not as an error', async () => {
	// `ssh host true` exits non-zero when the host is down, and exec rejects on
	// non-zero exit — so the natural implementation rejects on the exact case
	// the policy most needs to understand.
	const p = probes({
		health: 'unhealthy',
		hostReachable: async () => { throw new Error('ssh: connect to host ... Network is unreachable'); },
	});

	const { state, actions } = await run(INITIAL, p, 20);

	assert.equal(reloads(actions).length, 0);
	assert.equal(state.kind, 'degraded');
});

test('graceTicks 0 reloads on the first unhealthy observation', async () => {
	const config: Config = { ...CONFIG, graceTicks: 0 };

	const { actions } = await run(INITIAL, probes({ health: 'unhealthy' }), 3, config);

	assert.equal(actions[0]?.kind, 'reload');
});
