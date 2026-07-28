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
	/** The remote channel has not answered since `since`. */
	| { kind: 'degraded'; since: number }
	/** A reload has been asked for. Terminal: nothing is asked for twice. */
	| { kind: 'reloadPending' };

export type Action =
	| { kind: 'none' }
	| { kind: 'reload' }
	/** Ask the user instead of reloading. `reason` explains why we did not just do it. */
	| { kind: 'prompt'; reason: 'dirty' | 'configured' };

export interface Probes {
	/** Round-trips the window's own remote channel. Must resolve, never hang. */
	health(): Promise<Health>;
	/** Whether the SSH host answers right now. */
	hostReachable(): Promise<boolean>;
	/** Whether any editor holds unsaved changes. */
	isDirty(): boolean;
}

export interface Config {
	/**
	 * How long the channel must stay unhealthy before a reload is considered.
	 * VS Code retries on its own for up to three hours, so most outages heal
	 * without a reload; this is what keeps a self-healing window from being
	 * reloaded out from under the user.
	 */
	gracePeriodMs: number;
	/** Reload even with unsaved editors. Off by default: the user's work wins. */
	reloadWhenDirty: boolean;
	/** Ask first even when nothing is unsaved. */
	promptBeforeReload: boolean;
}

export interface Outcome {
	state: State;
	action: Action;
	/** Human-readable reason for the transition, for the log. */
	note?: string;
}

export const INITIAL: State = { kind: 'healthy' };

export async function tick(
	state: State,
	probes: Probes,
	config: Config,
	now: number,
): Promise<Outcome> {
	const health = await probes.health();

	// A window that answers is a window that needs nothing, whatever it needed
	// before. This is the edge back out of every other state, and its absence is
	// what made the original extension reload windows that had already recovered.
	if (health === 'healthy') {
		if (state.kind === 'healthy') {
			return { state, action: { kind: 'none' } };
		}
		return { state: { kind: 'healthy' }, action: { kind: 'none' }, note: 'connection recovered' };
	}

	// Asking twice is the dialog loop, so a decision once made is not revisited.
	if (state.kind === 'reloadPending') {
		return { state, action: { kind: 'none' } };
	}

	const since = state.kind === 'degraded' ? state.since : now;
	const degraded: State = { kind: 'degraded', since };

	if (now - since < config.gracePeriodMs) {
		return { state: degraded, action: { kind: 'none' } };
	}

	// Reloading spends the one resolve attempt VS Code does not retry, so it is
	// only worth spending when the host can actually answer.
	if (!(await probes.hostReachable())) {
		return { state: degraded, action: { kind: 'none' }, note: 'host still unreachable' };
	}

	if (!config.reloadWhenDirty && probes.isDirty()) {
		return { state: { kind: 'reloadPending' }, action: { kind: 'prompt', reason: 'dirty' } };
	}

	if (config.promptBeforeReload) {
		return { state: { kind: 'reloadPending' }, action: { kind: 'prompt', reason: 'configured' } };
	}

	return { state: { kind: 'reloadPending' }, action: { kind: 'reload' } };
}
