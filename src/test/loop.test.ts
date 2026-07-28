import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Loop, type LoopHost } from '../loop';

/** A hand-cranked clock: timers fire only when the test says so. */
function harness(run: () => Promise<void>) {
	const pending = new Map<number, { fn: () => void; at: number }>();
	const errors: unknown[] = [];
	let nextId = 1;
	let now = 0;

	const host: LoopHost = {
		run,
		delayMs: () => 5_000,
		onError: err => void errors.push(err),
		setTimeout: (fn, ms) => {
			const id = nextId++;
			pending.set(id, { fn, at: now + ms });
			return id;
		},
		clearTimeout: handle => void pending.delete(handle as number),
	};

	/** Fires every timer due at or before `now + ms`, in order. */
	const advance = async (ms: number) => {
		now += ms;
		for (const [id, t] of [...pending].sort((a, b) => a[1].at - b[1].at)) {
			if (t.at <= now && pending.delete(id)) {
				t.fn();
				await Promise.resolve();
			}
		}
		await Promise.resolve();
	};

	return { host, advance, errors, pendingCount: () => pending.size };
}

/** A run() that does not settle until released. */
function gated() {
	let release!: () => void;
	let calls = 0;
	const gate = new Promise<void>(resolve => {
		release = resolve;
	});
	return { run: () => (calls++, gate), release: () => release(), calls: () => calls };
}

test('a tick already in flight is joined, not duplicated', async () => {
	// Two concurrent ticks would both read the pre-reload state and both decide
	// to reload, and each would schedule its own successor.
	const g = gated();
	const h = harness(g.run);
	const loop = new Loop(h.host);

	loop.start();
	await h.advance(0);
	assert.equal(g.calls(), 1, 'the loop starts one tick');

	const manual = loop.runNow();
	await Promise.resolve();
	assert.equal(g.calls(), 1, 'asking for a check while one is running must not start a second');

	g.release();
	await manual;
	await h.advance(0);
	assert.equal(h.pendingCount(), 1, 'exactly one timer survives, so the loop cannot fork');
});

test('the loop keeps exactly one timer across many ticks', async () => {
	const h = harness(async () => {});
	const loop = new Loop(h.host);

	loop.start();
	for (let i = 0; i < 10; i++) {
		await h.advance(5_000);
		assert.equal(h.pendingCount(), 1, `one timer after tick ${i + 1}`);
	}
});

test('a failing tick is reported and the loop carries on', async () => {
	// Going quiet on an unexpected error is the failure this rewrite exists to
	// avoid: it looks identical to a healthy window.
	let calls = 0;
	const h = harness(async () => {
		calls++;
		throw new Error(`boom ${calls}`);
	});
	const loop = new Loop(h.host);

	loop.start();
	await h.advance(0);
	await h.advance(5_000);
	await h.advance(5_000);

	assert.equal(calls, 3, 'the loop survives its own failures');
	assert.deepEqual(h.errors.map(String), ['Error: boom 1', 'Error: boom 2', 'Error: boom 3']);
	assert.equal(h.pendingCount(), 1);
});

test('stopping ends the loop and leaves no timer behind', async () => {
	let calls = 0;
	const h = harness(async () => void calls++);
	const loop = new Loop(h.host);

	loop.start();
	await h.advance(0);
	loop.stop();
	await h.advance(60_000);

	assert.equal(calls, 1);
	assert.equal(h.pendingCount(), 0);
});

test('a tick that fails while stopping does not resurrect the loop', async () => {
	const g = gated();
	const h = harness(g.run);
	const loop = new Loop(h.host);

	loop.start();
	await h.advance(0);
	loop.stop();
	g.release();
	await h.advance(0);

	assert.equal(h.pendingCount(), 0, 'a settling tick must not schedule past stop()');
});
