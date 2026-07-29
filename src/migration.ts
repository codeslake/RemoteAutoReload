/**
 * Telling users about a setting that no longer does anything.
 *
 * Its own module, with no VS Code import, so it can be tested directly.
 */

/** The slice of `ExtensionContext.globalState` this needs. */
export interface Remembered {
	get<T>(key: string): T | undefined;
	update(key: string, value: unknown): Thenable<void>;
}

const SHOWN = 'removedEnabledSettingWarned';

/**
 * Warns the one person the removal actually changed things for, once.
 *
 * `remoteAutoReload.enabled` is gone in 0.2.0. Anyone who had it at `false` had
 * opted out of exactly the behaviour that removal switches back on, and VS Code
 * says nothing about it beyond greying the key.
 *
 * Once per install, not once per activation: this extension reloads windows for
 * a living and every reload reactivates it, so a flapping link would otherwise
 * mean a notification per reload — with no way to stop it, since the setting is
 * gone from the Settings UI too.
 */
export async function removedSettingWarning(
	enabledWas: boolean | undefined,
	remembered: Remembered,
): Promise<string | undefined> {
	if (enabledWas !== false || remembered.get<boolean>(SHOWN)) {
		return undefined;
	}
	await remembered.update(SHOWN, true);
	return (
		'"remoteAutoReload.enabled" was removed in 0.2.0 and no longer switches anything off, ' +
		'so this window is being watched again. Disable the extension, or run ' +
		'"RemoteAutoReload: Pause Watching This Window", instead.'
	);
}
