/**
 * The reload decision, isolated from VS Code.
 *
 * Everything this module needs from the outside world arrives through `Probes`,
 * so the policy can be exercised without a window, a network, or a clock.
 */

/** Result of asking "is this window's remote channel answering?". */
export type Health = 'healthy' | 'unhealthy';

export type State =
	/** The remote channel answered on the last tick. */
	| { kind: 'healthy' }
	/** The channel has not answered for `ticks` consecutive observations. */
	| { kind: 'degraded'; ticks: number }
	/** A reload or a prompt has been issued. Terminal: nothing is issued twice. */
	| { kind: 'reloadPending' }
	/**
	 * The user declined a reload, or paused this window. Terminal until an
	 * explicit resume: recovering on its own must not re-arm a window whose
	 * owner has already said no, or a flapping link asks forever.
	 */
	| { kind: 'idle'; reason: 'declined' | 'paused' };

export type Action =
	| { kind: 'none' }
	| { kind: 'reload' }
	/** Ask the user instead of reloading. `reason` explains why we did not just do it. */
	| { kind: 'prompt'; reason: 'dirty' | 'configured' };

/** Out-of-band input: the user's answer to a prompt, or a palette command. */
export type Command = 'decline' | 'pause' | 'resume';

export interface Probes {
	/**
	 * Round-trips the window's own remote channel.
	 * A rejection means "cannot tell", which is neither healthy nor unhealthy.
	 */
	health(): Promise<Health>;
	/**
	 * Whether the SSH host answers right now.
	 * A rejection means "cannot confirm", which is treated as unreachable.
	 */
	hostReachable(): Promise<boolean>;
	/** Whether any editor holds unsaved changes. */
	isDirty(): boolean;
}

export interface Config {
	/**
	 * How many consecutive unhealthy observations before a reload is considered.
	 *
	 * Counted in observations rather than elapsed time on purpose: VS Code
	 * retries on its own for up to three hours, and the grace period exists to
	 * let it. A wall clock would hand the whole grace period to a laptop that
	 * merely slept through it, reloading before core got a single attempt.
	 */
	graceTicks: number;
	/** Reload even with unsaved editors. Off by default: the user's work wins. */
	reloadWhenDirty: boolean;
	/** Ask first even when nothing is unsaved. */
	promptBeforeReload: boolean;
}

export interface Outcome {
	state: State;
	action: Action;
	/** Why the tick did what it did, for the log. */
	note?: string;
}

export const INITIAL: State = { kind: 'healthy' };

/** Folds a user command into the state. Pure, so the caller cannot diverge from it. */
export function applyCommand(_state: State, command: Command): State {
	switch (command) {
		case 'decline':
			return { kind: 'idle', reason: 'declined' };
		case 'pause':
			return { kind: 'idle', reason: 'paused' };
		case 'resume':
			return INITIAL;
	}
}

/**
 * Advances the policy by one observation.
 *
 * Not re-entrant: a tick reads the state it was given and returns the next one,
 * so overlapping calls would both see the pre-reload state and both ask for a
 * reload. The caller must await each tick before starting the next.
 */
export async function tick(state: State, probes: Probes, config: Config): Promise<Outcome> {
	const unchanged = (note?: string): Outcome =>
		note === undefined ? { state, action: { kind: 'none' } } : { state, action: { kind: 'none' }, note };

	if (state.kind === 'idle') {
		return unchanged();
	}

	const health = await probes.health().catch(() => undefined);
	if (health === undefined) {
		// Neither answer is safe to assume: 'healthy' would clear a real outage,
		// 'unhealthy' would march a working window toward a reload.
		return unchanged('health probe failed, holding state');
	}

	// A window that answers needs nothing, whatever it needed before. The absence
	// of this edge is what made the original reload windows that had recovered.
	if (health === 'healthy') {
		switch (state.kind) {
			case 'healthy':
				return unchanged();
			case 'degraded':
			case 'reloadPending':
				return { state: INITIAL, action: { kind: 'none' }, note: 'connection recovered' };
		}
	}

	// Asking twice is the dialog loop, so a decision once made is not revisited.
	if (state.kind === 'reloadPending') {
		return unchanged();
	}

	const ticks = (state.kind === 'degraded' ? state.ticks : 0) + 1;
	if (ticks <= config.graceTicks) {
		return {
			state: { kind: 'degraded', ticks },
			action: { kind: 'none' },
			note: `unhealthy ${ticks}/${config.graceTicks + 1}, waiting for VS Code to reconnect on its own`,
		};
	}

	// Reloading spends the one resolve attempt VS Code does not retry, so it is
	// only worth spending when the host can actually answer.
	const reachable = await probes.hostReachable().catch(() => false);
	if (!reachable) {
		return {
			state: { kind: 'degraded', ticks },
			action: { kind: 'none' },
			note: 'host still unreachable, not spending the one resolve attempt',
		};
	}

	if (!config.reloadWhenDirty && probes.isDirty()) {
		return {
			state: { kind: 'reloadPending' },
			action: { kind: 'prompt', reason: 'dirty' },
			note: 'unsaved editors, asking instead of reloading',
		};
	}

	if (config.promptBeforeReload) {
		return {
			state: { kind: 'reloadPending' },
			action: { kind: 'prompt', reason: 'configured' },
			note: 'promptBeforeReload is on, asking first',
		};
	}

	return { state: { kind: 'reloadPending' }, action: { kind: 'reload' }, note: 'host reachable, reloading' };
}
