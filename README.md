# RemoteAutoReload

Reloads a Remote-SSH window once its host is reachable again, so you stop
clicking **Retry** after every VPN drop, sleep, and network change.

It presses that button for you, and nothing else: a healthy window shows no
status item and no notifications.

## Setup

1. Install the extension **locally** (not on the remote).
2. Add this to your user `settings.json`:

   ```jsonc
   "window.dialogStyle": "custom"
   ```

That is the whole setup. Your `~/.ssh/config` needs no changes — the extension
runs plain `ssh`, so whatever `Host`, `Port`, `ProxyJump` and `IdentityFile` you
already use for Remote-SSH apply unchanged.

<details>
<summary>Why <code>window.dialogStyle</code> matters</summary>

When a connection fails, Remote-SSH raises **"Could not establish connection …"**
as a modal. At VS Code's default of `native` that modal is an operating-system
window, so reloading reconnects *underneath* it and the error stays on screen:
fixed, but you still have a dialog to dismiss.

Set to `custom` the dialog belongs to the window, and the reload takes it away
with the failure it described. The extension logs a warning if you leave it
native.
</details>

## Requirements

- VS Code 1.75+
- `ssh` on your `PATH` (macOS, Linux, and Windows 10+ all ship it)
- An SSH key that works without a passphrase prompt — the reachability probe runs
  with `BatchMode=yes` and cannot answer one. Keep the key in your agent
  (`ssh-add`), or set `hostProbeCommand` to something that works unattended.

## Settings

All machine-scoped: a workspace you open cannot change them.

| Setting | Default | |
|---|---|---|
| `pollIntervalMs` | `5000` | How often to check. |
| `graceTicks` | `12` | Failed checks to wait out before reloading. Counted in checks, not seconds, so sleeping through them does not skip them. |
| `healthTimeoutMs` | `10000` | A slower check is inconclusive, not failed — a dead channel refuses at once, so a slow one means a busy remote. |
| `hostProbeTimeoutMs` | `8000` | Cap on the host probe. |
| `reloadWhenDirty` | `false` | Reload even with unsaved editors. Leave off. |
| `promptBeforeReload` | `false` | Always ask, even with nothing unsaved. |
| `hostProbeCommand` | `""` | Replaces the default probe. `${host}` and `${port}` are substituted and shell-quoted. Empty means `ssh -o BatchMode=yes -o ConnectTimeout=5 <host> true`. |

Prefix each with `remoteAutoReload.`, e.g. `"remoteAutoReload.graceTicks": 20`.

## Commands

Under **RemoteAutoReload** in the command palette: **Show Log**, **Check
Connection Now**, **Pause / Resume Watching This Window**.

To reload by hand, use VS Code's own **Developer: Reload Window**.

## What you will see

Nothing, while things work.

When the connection drops, a status item appears — `Reconnecting to <host>` —
and its tooltip says the window will reload itself, so the error dialog can be
left alone. Once the host answers, the window reloads and both go away.

A measured run, with the host taken away and given back:

```
00:47:15  Watching myhost
00:47:23  host still unreachable, not spending the one resolve attempt
          ← host comes back at 00:47:32
00:47:42  host reachable, reloading
00:47:53  Watching myhost
```

Eleven seconds from "the host is back" to a working window, and the error dialog
goes with the reload. No clicks.

With unsaved changes it asks instead of reloading, and asks **once**; dismissing
means no until you run **Resume Watching This Window**.

## How it decides

Every few seconds, in Remote-SSH windows only:

1. **Is this window's channel answering?** Asked via `workspace.fs`, which
   travels the same connection VS Code uses — no process scraping, so several
   windows on one host never confuse each other.
2. **Has it failed long enough?** VS Code retries on its own for up to three
   hours and is good at it, so a window that *was* connected waits out
   `graceTicks` first. A window whose very first connection failed does not wait:
   VS Code treats that as fatal and never retries.
3. **Is the host actually up?** A reload spends the one connection attempt VS
   Code will not retry, so it is not spent on a host that cannot answer.
4. **Would a reload cost anything?** Unsaved changes turn the reload into a
   question.

## Troubleshooting

Check the log first: **RemoteAutoReload: Show Log**. It opens with
`Watching <host>`; anything else says why not.

| Symptom | |
|---|---|
| `Not a Remote-SSH window` in a remote window | The extension is installed on the remote. It must run locally. |
| `no remote folder open` | Nothing to probe. Open your folder. |
| No log lines at all | It never activated — check it is enabled. |
| Reconnected, but the dialog is still there | `window.dialogStyle` is still `native`. See [Setup](#setup). |
| `host still unreachable` but ssh works for you | The probe cannot answer a passphrase prompt. Add the key to your agent, or set `hostProbeCommand`. |
| Reloads into the same error | The probe proves sshd answers, not that the VS Code server will start. Kill it on the remote (`pkill -f vscode-server`) and let it reinstall. |
| Waits too long or too little | Roughly `(graceTicks + 1) × pollIntervalMs` — about a minute by default. |

## Relationship to Remreload

A rewrite of [viveksjain/remreload](https://github.com/viveksjain/remreload)
(MIT, © 2021 Vivek Jain), which is where the idea comes from. Two things changed:

**Detection.** Remreload finds the `ssh -D` tunnel by matching `lsof` and `pgrep`
output and watches whether that pid lives. With several windows on one host the
match can land on another window's tunnel, and if the lookup fails at startup —
which is exactly what a disconnected window does — it stops for the life of the
window. Here the window's own channel is round-tripped instead: per-window by
construction, no pid.

**When a reload is warranted.** Remreload reloads as soon as a connectivity
command succeeds, by default `ping google.com`. This one waits out a grace
period, probes the actual host, refuses to discard unsaved work, and asks at most
once.

## Development

```sh
npm install
npm test      # compiles, then runs node:test — no VS Code needed
```

Everything with a decision in it is a module with no VS Code import, so it is
tested directly: `supervisor.ts` (the reload policy, a pure state machine),
`authority.ts` (reading the host out of a remote authority, including the
encoded form), `health.ts` (what a filesystem error says about the connection),
`probecommand.ts` (the probe command line and its quoting), `loop.ts` (one tick
at a time), `statusbar.ts` (the wording). `probes.ts` answers the policy's
questions using VS Code and `ssh`; `extension.ts` is wiring.

To turn it off, disable the extension the usual way, or **Pause Watching This
Window** for just one window.

## License

MIT. See [LICENSE](LICENSE), which carries both copyright notices.
