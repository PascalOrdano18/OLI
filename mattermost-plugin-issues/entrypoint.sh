#!/bin/sh
# Custom entrypoint: start Mattermost, then auto-enable the issues plugin
# on first boot using the local socket API (mmctl --local).

PLUGIN_ID="com.mattermost.issues"
MARKER="/tmp/.plugin-configured"

# Start Mattermost in the background
/mattermost/bin/mattermost server &
MM_PID=$!

# If already configured on a previous boot, just wait for Mattermost
if [ -f "$MARKER" ]; then
    echo "[entrypoint] Plugin already configured on a previous boot, skipping setup."
    wait $MM_PID
    exit $?
fi

echo "[entrypoint] First boot detected — waiting for Mattermost to start..."

# Wait for the local socket to appear (max ~3 minutes)
SOCKET="/var/tmp/mattermost_local.socket"
ATTEMPTS=0
MAX_ATTEMPTS=90
while [ ! -S "$SOCKET" ] && [ $ATTEMPTS -lt $MAX_ATTEMPTS ]; do
    sleep 2
    ATTEMPTS=$((ATTEMPTS + 1))
done

if [ ! -S "$SOCKET" ]; then
    echo "[entrypoint] WARNING: Local socket never appeared after ${MAX_ATTEMPTS} attempts, skipping plugin setup."
    wait $MM_PID
    exit $?
fi

echo "[entrypoint] Local socket ready. Waiting for server to be fully initialized..."

# Wait until at least one team exists — the provisioning API creates the admin
# user and default team after the server is reachable. The plugin's OnActivate
# needs teams to exist (for creating the notification channel).
TEAM_ATTEMPTS=0
MAX_TEAM_ATTEMPTS=120
while [ $TEAM_ATTEMPTS -lt $MAX_TEAM_ATTEMPTS ]; do
    TEAMS=$(/mattermost/bin/mmctl team list --local 2>/dev/null)
    if [ -n "$TEAMS" ] && echo "$TEAMS" | grep -qv "^Unable\|^Error\|^No teams"; then
        echo "[entrypoint] Teams found, server is ready."
        break
    fi
    sleep 5
    TEAM_ATTEMPTS=$((TEAM_ATTEMPTS + 1))
    if [ $((TEAM_ATTEMPTS % 12)) -eq 0 ]; then
        echo "[entrypoint] Still waiting for teams to be created... (attempt ${TEAM_ATTEMPTS}/${MAX_TEAM_ATTEMPTS})"
    fi
done

if [ $TEAM_ATTEMPTS -ge $MAX_TEAM_ATTEMPTS ]; then
    echo "[entrypoint] WARNING: No teams found after ${MAX_TEAM_ATTEMPTS} attempts, enabling plugin anyway."
fi

# Small buffer for any remaining initialization
sleep 3

echo "[entrypoint] Enabling plugin ${PLUGIN_ID}..."
/mattermost/bin/mmctl plugin enable "$PLUGIN_ID" --local 2>&1

if [ $? -eq 0 ]; then
    echo "[entrypoint] Plugin enabled successfully."
else
    echo "[entrypoint] WARNING: Failed to enable plugin, retrying in 10s..."
    sleep 10
    /mattermost/bin/mmctl plugin enable "$PLUGIN_ID" --local 2>&1
fi

# Mark as configured
touch "$MARKER" 2>/dev/null || true
echo "[entrypoint] First-boot plugin setup complete."

# Wait for Mattermost to exit
wait $MM_PID
