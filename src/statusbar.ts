/**
 * What the status bar says about a state.
 *
 * Its own module, with no VS Code import, so the wording is testable. The
 * wording matters more than it looks: when the connection drops, VS Code puts a
 * modal error dialog on screen and this is the only thing telling the user that
 * something is already working on it.
 */

import type { State } from './supervisor';

export interface StatusText {
	/** Status bar label. A codicon in `$(name)` form, then a few words. */
	text: string;
	/** Hover text. Says what happens next, since the label has no room to. */
	tooltip: string;
}

/** A healthy window says nothing at all: an item always there stops being read. */
export function isVisible(state: State): boolean {
	return state.kind !== 'healthy' && state.kind !== 'starting';
}

export function statusFor(state: State, host: string): StatusText {
	switch (state.kind) {
		case 'starting':
		case 'healthy':
			return { text: `$(check) ${host}`, tooltip: `Connected to ${host}.` };

		case 'degraded':
			return {
				text: `$(sync~spin) Reconnecting to ${host}`,
				tooltip:
					`${host} is not answering (${state.ticks} failed ${state.ticks === 1 ? 'check' : 'checks'}).\n` +
					'This window will reload itself as soon as the host is reachable, so any ' +
					'connection error dialog can be left alone.',
			};

		case 'reloadPending':
			return {
				text: `$(debug-restart) Reloading ${host}`,
				tooltip: `${host} answered. Reloading this window to reconnect.`,
			};

		case 'idle':
			return state.reason === 'paused'
				? {
						text: `$(debug-pause) ${host} paused`,
						tooltip: `Not watching ${host}. Run "RemoteAutoReload: Resume Watching This Window" to start again.`,
					}
				: {
						text: `$(debug-pause) ${host} not reloading`,
						tooltip:
							`You declined the reload, so ${host} is left alone even when it comes back.\n` +
							'Run "RemoteAutoReload: Resume Watching This Window" to change that.',
					};
	}
}
