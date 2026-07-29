/**
 * Whether VS Code's dialogs can be cleared by a window reload.
 *
 * Its own module, with no VS Code import, so it can be tested directly.
 */

/**
 * Says what is wrong when dialogs are native, or nothing when they are not.
 *
 * Remote-SSH raises its "Could not establish connection" error as a modal. With
 * `window.dialogStyle` at its default of `native` that modal is an OS window, so
 * reloading the window reconnects underneath it and leaves the error on screen:
 * the connection is fixed but the user still has a dialog to dismiss, which
 * reads as the reload having done nothing.
 *
 * Set to `custom` the dialog is part of the workbench, and the reload takes it
 * away along with the failure it described.
 */
export function nativeDialogWarning(dialogStyle: string | undefined): string | undefined {
	if (dialogStyle === 'custom') {
		return undefined;
	}
	return (
		'Set "window.dialogStyle": "custom" so a reload can clear the connection-error dialog. ' +
		'Left native, that dialog is an OS window: this extension reconnects underneath it and the ' +
		'error stays on screen.'
	);
}
