import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tick, INITIAL, type Config, type Health, type Probes, type State } from '../supervisor';

const CONFIG: Config = {
	gracePeriodMs: 20_000,
	reloadWhenDirty: false,
	promptBeforeReload: false,
};

function probes(over: Partial<{ health: Health; hostReachable: boolean; dirty: boolean }> = {}): Probes {
	const { health = 'healthy', hostReachable = true, dirty = false } = over;
	return {
		health: async () => health,
		hostReachable: async () => hostReachable,
		isDirty: () => dirty,
	};
}

test('a brief outage does not reload: the window is given the grace period to heal itself', async () => {
	const degradedAt = 1_000;

	const first = await tick(INITIAL, probes({ health: 'unhealthy' }), CONFIG, degradedAt);
	assert.deepEqual(first.state, { kind: 'degraded', since: degradedAt } satisfies State);
	assert.equal(first.action.kind, 'none');

	const stillWaiting = await tick(
		first.state,
		probes({ health: 'unhealthy' }),
		CONFIG,
		degradedAt + CONFIG.gracePeriodMs - 1,
	);
	assert.equal(stillWaiting.action.kind, 'none', 'must not reload before the grace period expires');
	assert.deepEqual(
		stillWaiting.state,
		{ kind: 'degraded', since: degradedAt } satisfies State,
		'the clock starts when the outage started, not when it was last observed',
	);
});

test('an outage that outlives the grace period reloads once the host is reachable', async () => {
	const degraded: State = { kind: 'degraded', since: 1_000 };
	const afterGrace = 1_000 + CONFIG.gracePeriodMs;

	const out = await tick(degraded, probes({ health: 'unhealthy', hostReachable: true }), CONFIG, afterGrace);

	assert.equal(out.action.kind, 'reload');
	assert.deepEqual(out.state, { kind: 'reloadPending' } satisfies State);
});

test('an unreachable host is never reloaded into: the one non-retried resolve is not spent on a doomed attempt', async () => {
	const degraded: State = { kind: 'degraded', since: 1_000 };
	const afterGrace = 1_000 + CONFIG.gracePeriodMs;

	const out = await tick(degraded, probes({ health: 'unhealthy', hostReachable: false }), CONFIG, afterGrace);

	assert.equal(out.action.kind, 'none');
	assert.deepEqual(out.state, degraded, 'stays degraded so it can reload as soon as the host returns');
});

test('unsaved work is never discarded: a dirty window is asked, not reloaded', async () => {
	const degraded: State = { kind: 'degraded', since: 1_000 };
	const afterGrace = 1_000 + CONFIG.gracePeriodMs;

	const out = await tick(degraded, probes({ health: 'unhealthy', dirty: true }), CONFIG, afterGrace);

	assert.deepEqual(out.action, { kind: 'prompt', reason: 'dirty' });
	assert.deepEqual(
		out.state,
		{ kind: 'reloadPending' } satisfies State,
		'asking is terminal too, so the prompt is raised once instead of every tick',
	);
});

test('promptBeforeReload asks even with nothing unsaved', async () => {
	const degraded: State = { kind: 'degraded', since: 1_000 };
	const config: Config = { ...CONFIG, promptBeforeReload: true };

	const out = await tick(degraded, probes({ health: 'unhealthy' }), config, 1_000 + config.gracePeriodMs);

	assert.deepEqual(out.action, { kind: 'prompt', reason: 'configured' });
});

test('reloadWhenDirty opts out of the safety net', async () => {
	const degraded: State = { kind: 'degraded', since: 1_000 };
	const config: Config = { ...CONFIG, reloadWhenDirty: true };

	const out = await tick(degraded, probes({ health: 'unhealthy', dirty: true }), config, 1_000 + config.gracePeriodMs);

	assert.equal(out.action.kind, 'reload');
});

test('a window that heals itself is not reloaded: recovery clears the degraded clock', async () => {
	const degraded: State = { kind: 'degraded', since: 1_000 };

	// Well past the grace period, but the channel is answering again — VS Code
	// reconnected on its own, which is the common case and needs no reload.
	const out = await tick(degraded, probes({ health: 'healthy' }), CONFIG, 1_000 + 3_600_000);

	assert.equal(out.action.kind, 'none');
	assert.deepEqual(out.state, { kind: 'healthy' } satisfies State);
});

test('a healed window degrades from scratch: the old outage does not count toward the new one', async () => {
	const recovered = await tick({ kind: 'degraded', since: 1_000 }, probes({ health: 'healthy' }), CONFIG, 50_000);
	const degradedAgain = await tick(recovered.state, probes({ health: 'unhealthy' }), CONFIG, 60_000);

	assert.deepEqual(degradedAgain.state, { kind: 'degraded', since: 60_000 } satisfies State);
	assert.equal(degradedAgain.action.kind, 'none', 'the earlier outage must not carry over and trigger immediately');
});

test('a reload is requested once and never repeated, so a blocked reload cannot loop', async () => {
	const pending: State = { kind: 'reloadPending' };

	const out = await tick(pending, probes({ health: 'unhealthy' }), CONFIG, 10_000_000);

	assert.equal(out.action.kind, 'none');
	assert.deepEqual(out.state, pending);
});

test('a window that reconnects while a reload is pending stops asking', async () => {
	const out = await tick({ kind: 'reloadPending' }, probes({ health: 'healthy' }), CONFIG, 10_000_000);

	assert.equal(out.action.kind, 'none');
	assert.deepEqual(out.state, { kind: 'healthy' } satisfies State, 'so the window is watched again from a clean slate');
});
