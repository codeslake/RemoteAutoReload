# RemoteAutoReload

Reloads a Remote-SSH window when its connection is permanently lost and the host
is reachable again, so you stop clicking **Retry** after every VPN drop and every
time the laptop wakes up.

Motivated by, and structurally based on,
[viveksjain/remreload](https://github.com/viveksjain/remreload) (MIT) — see
[Relationship to Remreload](#relationship-to-remreload).

## Why this exists

VS Code already retries a dropped remote connection on its own, patiently:
`maxReconnectionAttempts` defaults to unlimited and the reconnection grace time
is three hours. Most outages heal with no help.

The gap is elsewhere. When the *first* resolve of a window fails — waking on a
network where the host is unreachable, or reloading during an outage — the
Remote-SSH resolver turns that failure into a fatal error with **no retry**. The
window parks on `Could not establish connection to "<host>": Network is
unreachable` and stays there. The host can come back a minute later and nothing
happens, because nothing is still trying.

That state is what this extension watches for. Nothing else about it is
interesting, so it tries hard to do nothing the rest of the time.

## What it does

Every few seconds, in Remote-SSH windows only:

1. **Is this window's channel answering?** Asked with `workspace.fs`, which
   travels the exact connection VS Code uses. No process scraping, so nothing to
   confuse when several windows are open to the same host.

   A dropped connection *refuses* the call at once, because the remote provider
   is unregistered. A call that merely takes a long time means something else:
   the remote is loaded and its extension host is briefly unresponsive. That is
   held as "no answer" and counts toward nothing, because reloading a window
   that was only slow is worse than doing nothing.
2. **If not, has it been failing long enough?** Thirteen consecutive refusals by
   default, about a minute. Short outages heal on their own, and waiting is what
   keeps them from being reloaded out from under you.
3. **Is the host actually reachable?** `ssh <host> true`. A reload spends the one
   resolve attempt VS Code will not retry, so it is not spent on a host that
   cannot answer.
4. **Would a reload cost you anything?** With unsaved changes it asks instead,
   and it asks **once** — dismissing means no.

Only when all four line up does the window reload. The reload is exactly what
the dialog's **Retry** button does, which is the whole idea: you should not have
to be at the keyboard to press it.

## Install

**From a release:** download the `.vsix` from
[Releases](https://github.com/codeslake/RemoteAutoReload/releases) and

```sh
code --install-extension remote-auto-reload-<version>.vsix
```

**From source:**

```sh
git clone https://github.com/codeslake/RemoteAutoReload.git
cd RemoteAutoReload
npm install
npx @vscode/vsce package
code --install-extension remote-auto-reload-*.vsix
```

Requires VS Code 1.75+ and `ssh` on your `PATH`; Node 22+ only to build. The
extension runs on the **local** machine, so install it locally, not in the
remote. If you point Remote-SSH at a different ssh binary with
`remote.SSH.path`, point `hostProbeCommand` at that one too.

**Also set this**, or the reload leaves a dialog behind:

```jsonc
"window.dialogStyle": "custom"
```

Remote-SSH raises its "Could not establish connection" error as a modal. At the
default `native` that modal is an OS window, so reloading the window reconnects
*underneath* it and the error stays on screen — the connection is fixed but you
still have a dialog to dismiss, which reads as the reload having done nothing.
Set to `custom` the dialog belongs to the workbench, and the reload takes it away
with the failure it described. The extension logs a warning if you leave it
native.

## Settings

All settings are machine-scoped: a workspace you open cannot change them, which
matters because one of them names a command to run.

| Setting | Default | What it does |
|---|---|---|
| `remoteAutoReload.enabled` | `true` | Master switch. |
| `remoteAutoReload.pollIntervalMs` | `5000` | How often to check. |
| `remoteAutoReload.graceTicks` | `12` | Failed checks to wait out before a reload is considered; the reload comes on the next one. Counted in checks, not elapsed time, so sleeping through the grace period does not skip it. |
| `remoteAutoReload.healthTimeoutMs` | `10000` | A health check slower than this is inconclusive, not failed: a dead channel refuses at once, so a slow one means a loaded remote. |
| `remoteAutoReload.hostProbeTimeoutMs` | `8000` | Cap on the host probe. |
| `remoteAutoReload.reloadWhenDirty` | `false` | Reload even with unsaved editors. Leave off. |
| `remoteAutoReload.promptBeforeReload` | `false` | Always ask, even with nothing unsaved. |
| `remoteAutoReload.hostProbeCommand` | `""` | Replaces the default probe. `${host}` becomes the ssh destination (including the user, e.g. `jun@box`) and `${port}` its port; both are shell-quoted. Empty means `ssh -o BatchMode=yes -o ConnectTimeout=5 <host> true`. |

Hosts connected as `user@host`, on a non-default port, or with a capital letter
in the name work too: Remote-SSH encodes those into the window's authority, and
the encoding is decoded rather than taken literally.

## Commands

Under **RemoteAutoReload** in the command palette:

- **Show Log** — what it decided and why. Also on the status bar item.
- **Check Connection Now** — run a check immediately.
- **Reload Window Now**
- **Pause / Resume Watching This Window**

## What you should see

A healthy window shows nothing at all: no status bar item, no notifications.

When the connection drops, a status bar item appears with the host name and a
spinner, and the log fills in:

```
Watching dev-box
unhealthy 1/13, waiting for VS Code to reconnect on its own
unhealthy 2/13, waiting for VS Code to reconnect on its own
...
host still unreachable, not spending the one resolve attempt
host reachable, reloading
Reloading window
```

If it recovers on its own first, the log says `connection recovered` and the
status item disappears. That is the common case and it is the one where doing
nothing is correct.

## Troubleshooting

**Nothing happens when I disconnect.** Check the log (**RemoteAutoReload: Show
Log**). It should open with `Watching <host>`; anything else says why not:

- `Not a Remote-SSH window` in a window that *is* remote means the extension
  installed into the remote instead of locally. It must run on the local machine.
- `no remote folder open` means the window has no folder to probe. Open the
  folder you work in and it starts watching.
- No lines at all means it never activated; check it is enabled in the
  Extensions view.

**It waits too long / too little.** `(graceTicks + 1)` × `pollIntervalMs` is
roughly how long an outage must last before anything happens. The default is
about a minute, deliberately longer than a blip and shorter than your patience.

**It never fires even though the window is clearly disconnected.** Check the log
for `no answer either way, holding state` repeating. That means the probe is
timing out rather than being refused, which is the signature of a remote that is
alive but very slow. Raise `healthTimeoutMs`.

**It says `host still unreachable` but I can ssh in fine.** The probe runs
`ssh -o BatchMode=yes`, which cannot answer a passphrase prompt. If your key
needs one, make sure it is in the agent (`ssh-add`), or set
`hostProbeCommand` to something that works unattended.

**It reloads into the same error dialog.** The probe proves sshd answers; it does
not prove the VS Code server will start. If the server itself is wedged on the
remote, kill it there (`pkill -f vscode-server`) and let it reinstall.

**It asked once and never again.** That is intended: dismissing the notification
means "no", and it holds until you resume. Run **Resume Watching This Window**.

**The window reconnected but the error dialog is still there.** That is
`window.dialogStyle` at its default. A native dialog is an OS window and outlives
the reload that fixed the connection; set it to `custom` (see
[Install](#install)) and it goes away with the reload. If you dismiss it
meanwhile you will find the window already connected behind it — the log will
show `host reachable, reloading` from before you touched anything.

## Relationship to Remreload

This is a rewrite of [viveksjain/remreload](https://github.com/viveksjain/remreload)
(MIT, © 2021 Vivek Jain), which is where the idea and the original approach come
from. The problem statement, the notion of gating a reload behind a connectivity
check, and the shape of the extension are all its. It is a good tool and this one
would not exist without it.

The rewrite changes how the two central questions are answered:

**How disconnection is detected.** Remreload finds the `ssh -D` tunnel process by
matching `lsof` and `pgrep` output, then watches whether that pid is alive. With
several windows open to one host, the match can land on another window's tunnel;
if the lookup fails at startup — which is what happens when the window is already
disconnected — the extension stops for the life of the window. Here the window's
own channel is round-tripped through `workspace.fs`, which is per-window by
construction and needs no pid.

**When a reload is warranted.** Remreload reloads as soon as a connectivity
command succeeds, by default `ping google.com`. This one waits out a grace period
first, so an outage VS Code will heal itself is left alone, then probes the actual
SSH host, then refuses to discard unsaved work, and asks at most once
([remreload#3](https://github.com/viveksjain/remreload/issues/3) is a reload
re-issued every five seconds against a confirmation dialog).

## Development

```sh
npm install
npm test        # compiles, then runs node:test — no VS Code needed
npm run watch
```

Everything with a decision in it is a module with no VS Code import, so it is
tested directly:

- `src/supervisor.ts` — the reload policy, a pure state machine with all I/O injected
- `src/authority.ts` — reading the SSH host out of a remote authority, including the encoded form
- `src/health.ts` — what a filesystem error code says about the connection
- `src/loop.ts` — running one tick at a time, with the timer injected

`src/probes.ts` answers the policy's questions using VS Code and `ssh`;
`src/extension.ts` is wiring.

## License

MIT. See [LICENSE](LICENSE), which carries both copyright notices.
