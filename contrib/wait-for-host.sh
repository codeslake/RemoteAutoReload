#!/bin/bash
# Remote-SSH `remote.SSH.preconnect` hook: hold the connection attempt until the
# host's SSH port answers.
#
# Why: Remote-SSH raises a modal "Could not establish connection to ...:
# Connecting with SSH timed out" when a window's FIRST resolve fails, and never
# retries that one. RemoteAutoReload cannot prevent it — the extension activates
# about 30ms after the failure, and no extension API can dismiss another
# extension's modal. This runs upstream of the failure instead: Remote-SSH
# spawns it before dialling and waits for it to exit, so blocking here blocks
# the dial, and the resolve that would have failed never happens.
#
# Remote-SSH passes NO arguments, so the host is named here. Point one copy per
# host at it from settings.json:
#
#   "remote.SSH.preconnect": {
#       "dev-box": "/Users/you/.ssh/vscode/wait-for-host.sh"
#   }
#
# The first run raises a "Execute pre-connection script?" prompt; answer
# "Allow and Don\'t Ask Again" and it stays quiet until the file changes.

HOST="CHANGE-ME"     # the Host name from your ~/.ssh/config
WAIT_SECONDS="${PRECONNECT_WAIT_SECONDS:-180}"

# Resolved fresh each attempt, so a config edit (or a DNS change) is picked up
# rather than frozen at the first read.
resolve() {
    eval "$(ssh -G "$HOST" 2>/dev/null | awk '
        $1=="hostname" {printf "target=%s\n", $2}
        $1=="port"     {printf "port=%s\n", $2}')"
}

# A TCP probe, not a full ssh handshake: ~0.1s instead of ~1.5s, and "does the
# port answer" is exactly the question worth asking. Each attempt is bounded,
# because a bare connect to a black-holed address hangs for the OS default
# (~75s) and would blow past WAIT_SECONDS entirely.
probe() {
    resolve
    [ -n "${target:-}" ] && [ -n "${port:-}" ] || return 0   # cannot tell -> do not block
    if command -v nc >/dev/null 2>&1; then
        nc -z -G 3 -w 3 "$target" "$port" 2>/dev/null
    else
        (exec 3<>"/dev/tcp/$target/$port") 2>/dev/null
    fi
}

deadline=$(( SECONDS + WAIT_SECONDS ))
until probe; do
    if [ "$SECONDS" -ge "$deadline" ]; then
        # Non-zero aborts the connection with this message, which says more than
        # the generic timeout modal it replaces.
        echo "$HOST ($target:$port) did not answer within ${WAIT_SECONDS}s"
        exit 1
    fi
    echo "waiting for $HOST ($target:$port)..."
    sleep 5
done

echo "$HOST is reachable"
