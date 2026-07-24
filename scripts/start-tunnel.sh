#!/usr/bin/env bash
# Start an ngrok tunnel to the dev server, wrapped in caffeinate so a locked
# laptop won't idle-sleep and drop the tunnel. Runs as ONE unit: kill this
# script (Ctrl+C) and both ngrok and the sleep-block stop together.
#
#   ./scripts/start-tunnel.sh          # tunnel to port 5001
#   ./scripts/start-tunnel.sh 3000     # tunnel to another port
#
# Ceiling: caffeinate can't beat clamshell sleep — keep the lid open, or stay
# on the power adapter (with an external display it runs lid-closed).
set -euo pipefail

PORT="${1:-5001}"

# One agent at a time — a second `ngrok http` just errors on the 4040 API port.
pkill -f "ngrok http" 2>/dev/null || true
sleep 1

# caffeinate runs ngrok as its child: -i idle, -m disk, -s system sleep blocked
# for exactly as long as ngrok lives.
caffeinate -ims ngrok http "$PORT" >/dev/null 2>&1 &
WRAP_PID=$!
trap 'kill "$WRAP_PID" 2>/dev/null || true' INT TERM

# ngrok's local API reports the public URL once the tunnel is established.
URL=""
for _ in $(seq 1 20); do
  URL=$(curl -s http://127.0.0.1:4040/api/tunnels 2>/dev/null \
    | python3 -c "import sys,json; print(next((t['public_url'] for t in json.load(sys.stdin).get('tunnels',[])), ''))" 2>/dev/null || true)
  [ -n "$URL" ] && break
  sleep 1
done

if [ -z "$URL" ]; then
  echo "ngrok did not report a tunnel — check 'ngrok http $PORT' manually" >&2
  kill "$WRAP_PID" 2>/dev/null || true
  exit 1
fi

echo "Tunnel up (sleep-protected): $URL -> http://localhost:$PORT"
echo "Ctrl+C to stop both ngrok and the sleep-block."
wait "$WRAP_PID"
