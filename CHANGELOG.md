# Changelog

## 0.2.0

**Removed `remoteAutoReload.enabled`.** VS Code already ships per-extension
disable, and **Pause Watching This Window** covers a single window, so there were
three switches for one job. If you had it set to `false`, that key now does
nothing and windows are watched again — disable the extension, or pause the
window, instead.

**Removed the `RemoteAutoReload: Reload Window Now` command.** It was a second
name for VS Code's own **Developer: Reload Window**. A keybinding pointing at
`remoteAutoReload.reloadNow` will no longer resolve; point it at
`workbench.action.reloadWindow`.

## 0.1.0

First release.
