#!/bin/bash
# Switch 9Router prod -> dev (Vite HMR). Vite binds public 20128, API engine 20129.
# Runs detached so it survives the caller's LLM stream dropping during the port swap.
set -u
cd /Users/macmini/9router-vite-migration || exit 1
LOG="$HOME/.9router/9router-dev.log"
echo "=== SWITCH TO DEV $(date) ===" >> "$LOG"

# 1) Build server first while prod is still live (minimize downtime).
node scripts/build-server.mjs >> "$LOG" 2>&1
echo "[switch] build:server done rc=$?" >> "$LOG"

# 2) Kill any stale 9router dev-vite (never touch laundrygarden).
for pid in $(pgrep -f "9router-vite-migration.*dev-vite" 2>/dev/null); do
  kill "$pid" 2>/dev/null && echo "[switch] killed stale dev-vite $pid" >> "$LOG"
done

# 3) Free port 20129 (old dev API) if lingering.
for pid in $(lsof -tiTCP:20129 -sTCP:LISTEN 2>/dev/null); do
  kill "$pid" 2>/dev/null && echo "[switch] freed 20129 pid $pid" >> "$LOG"
done

# 4) Stop old prod bound to 20128.
OLD=$(lsof -tiTCP:20128 -sTCP:LISTEN 2>/dev/null)
if [ -n "$OLD" ]; then
  kill $OLD 2>/dev/null
  echo "[switch] SIGTERM prod 20128 pid(s): $OLD" >> "$LOG"
fi
# Wait up to ~8s for 20128 to release.
for i in $(seq 1 40); do
  lsof -tiTCP:20128 -sTCP:LISTEN >/dev/null 2>&1 || break
  sleep 0.2
done
if lsof -tiTCP:20128 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "[switch] WARN 20128 still bound, forcing" >> "$LOG"
  kill -9 $(lsof -tiTCP:20128 -sTCP:LISTEN 2>/dev/null) 2>/dev/null
  sleep 1
fi

# 5) Start dev: Vite on 20128 (public), API engine on 20129.
DATA_DIR="$HOME/.9router" \
PORT=20128 API_PORT=20129 \
VITE_HOST=0.0.0.0 API_HOSTNAME=127.0.0.1 HOST=0.0.0.0 \
NODE_ENV=development \
nohup node scripts/dev-vite.mjs >> "$LOG" 2>&1 &
echo "[switch] dev-vite spawned pid $!" >> "$LOG"
disown 2>/dev/null || true
