#!/bin/bash
# safe-restart-9router.sh
# Zero-downtime restart untuk 9Router via blue-green port flip + auto-rebuild.
#
# Cara kerja:
#   1. Auto-rebuild (Vite + Express bundle) kalau source berubah sejak build terakhir
#   2. Spawn instance baru di PORT_NEW (20129) — instance lama di PORT_LIVE (20128) tetap jalan
#   3. Health check instance baru sampai ready (max 60s)
#   4. Kalau healthy → kill instance lama, switch launchd ke instance baru
#   5. Kalau gagal → kill instance baru, instance lama tetap jalan (no downtime)
#
# Usage:
#   ./scripts/safe-restart-9router.sh           # rebuild-if-needed + restart
#   ./scripts/safe-restart-9router.sh --no-build  # skip rebuild, restart only
#   ./scripts/safe-restart-9router.sh --force-build  # force rebuild walau gak ada perubahan

set -euo pipefail

ROOT_DIR="/Users/macmini/9router-griphub"
NODE_BIN="/Users/macmini/.local/share/fnm/node-versions/v22.23.1/installation/bin/node"
NPM_BIN="/Users/macmini/.local/share/fnm/node-versions/v22.23.1/installation/bin/npm"
SERVER_ENTRY="$ROOT_DIR/dist-server/index.js"
LAUNCHD_LABEL="ai.9router.gateway"
PORT_LIVE=20128
PORT_NEW=20129
HEALTH_TIMEOUT=60
LOG_DIR="$ROOT_DIR/.logs"
DATA_DIR="${DATA_DIR:-$HOME/.9router}"
DB_FILE="$DATA_DIR/db/data.sqlite"
BACKUP_DIR="$DATA_DIR/db/backups"

mkdir -p "$LOG_DIR"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }
fail() { log "ERROR: $*" >&2; exit 1; }

db_fingerprint() {
  python3 - "$DB_FILE" <<'PY'
import sqlite3, sys
db = sqlite3.connect(f"file:{sys.argv[1]}?mode=ro", uri=True)
tables = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
names = ("settings", "providerConnections", "providerNodes", "apiKeys", "combos", "kv")
print(";".join(f"{name}={db.execute(f'SELECT COUNT(*) FROM {name}').fetchone()[0]}" for name in names if name in tables))
db.close()
PY
}

backup_database() {
  mkdir -p "$BACKUP_DIR"
  local backup_file="$BACKUP_DIR/pre-vite-cutover-$(date '+%Y%m%d-%H%M%S').sqlite"
  python3 - "$DB_FILE" "$backup_file" <<'PY'
import sqlite3, sys
source = sqlite3.connect(f"file:{sys.argv[1]}?mode=ro", uri=True)
target = sqlite3.connect(sys.argv[2])
source.backup(target)
target.close()
source.close()
PY
  [ -s "$backup_file" ] || fail "SQLite backup was not created"
  log "💾 Data backup created: $backup_file"
}

# Parse args
DO_BUILD="auto"
for arg in "$@"; do
  case "$arg" in
    --no-build) DO_BUILD="no" ;;
    --force-build) DO_BUILD="yes" ;;
  esac
done

# ============================================================================
# Step 1: Auto-rebuild detection
# ============================================================================
needs_rebuild() {
  [ ! -f "$SERVER_ENTRY" ] || [ ! -f "$ROOT_DIR/dist/index.html" ] && return 0
  local build_time
  build_time=$(stat -f %m "$SERVER_ENTRY" 2>/dev/null || echo 0)
  # Rebuild kalau ada file di src/ atau open-sse/ yang lebih baru dari build
  local newest_src
  newest_src=$(find "$ROOT_DIR/src" "$ROOT_DIR/open-sse" "$ROOT_DIR/server" "$ROOT_DIR/scripts/build-server.mjs" "$ROOT_DIR/vite.config.mjs" "$ROOT_DIR/index.html" \
    -type f \( -name "*.js" -o -name "*.mjs" -o -name "*.json" \) \
    -not -path "*/node_modules/*" \
    -exec stat -f %m {} \; 2>/dev/null | sort -n | tail -1)
  newest_src=${newest_src:-0}
  [ "$newest_src" -gt "$build_time" ]
}

if [ "$DO_BUILD" = "yes" ] || { [ "$DO_BUILD" = "auto" ] && needs_rebuild; }; then
  log "🔨 Rebuilding 9Router..."
  cd "$ROOT_DIR"
  PATH="$(dirname "$NODE_BIN"):$PATH" "$NPM_BIN" run build > "$LOG_DIR/build.log" 2>&1 \
    || fail "Build failed. Check $LOG_DIR/build.log"
  log "✅ Build complete"

elif [ "$DO_BUILD" = "auto" ]; then
  log "⏭️  No source changes — skipping rebuild"
fi

[ -f "$SERVER_ENTRY" ] || fail "No dist-server/index.js — run 'npm run build' first"
[ -f "$ROOT_DIR/dist/index.html" ] || fail "No dist/index.html — run 'npm run build' first"

# Existing installations must keep the same persistent state. Never cut over to
# an empty/new database silently: back up the live SQLite file and compare only
# non-secret row counts before replacing the running process.
if [ -f "$DB_FILE" ]; then
  BASELINE_DB_FINGERPRINT=$(db_fingerprint)
  [ -n "$BASELINE_DB_FINGERPRINT" ] || fail "Existing SQLite database has no expected tables: $DB_FILE"
  backup_database
  log "🔒 Persistent data preflight passed: $DB_FILE"
else
  BASELINE_DB_FINGERPRINT=""
  [ -z "$(lsof -ti :$PORT_LIVE -sTCP:LISTEN 2>/dev/null | head -1 || true)" ] \
    || fail "Live instance exists but persistent database is missing: $DB_FILE"
  log "ℹ️  Fresh installation: no existing SQLite database"
fi

# ============================================================================
# Step 2: Detect instance lama
# ============================================================================
OLD_PID=$(lsof -ti :$PORT_LIVE -sTCP:LISTEN 2>/dev/null | head -1 || true)
if [ -n "$OLD_PID" ]; then
  log "📍 Current live instance: PID $OLD_PID on port $PORT_LIVE"
else
  log "⚠️  No instance running on $PORT_LIVE — this will be a fresh start"
fi

# ============================================================================
# Step 3: Spawn instance baru di PORT_NEW
# ============================================================================
log "🚀 Spawning new instance on port $PORT_NEW..."
cd "$ROOT_DIR"
PORT=$PORT_NEW HOSTNAME=127.0.0.1 NODE_ENV=production DATA_DIR="$DATA_DIR" \
  nohup "$NODE_BIN" "$SERVER_ENTRY" \
  > "$LOG_DIR/green-instance.log" 2>&1 &
NEW_PID=$!
log "   New instance PID: $NEW_PID"

# Cleanup function — kill new instance on failure
cleanup_new() {
  if kill -0 "$NEW_PID" 2>/dev/null; then
    log "🧹 Cleaning up new instance (PID $NEW_PID)"
    kill "$NEW_PID" 2>/dev/null || true
    sleep 1
    kill -9 "$NEW_PID" 2>/dev/null || true
  fi
}
trap cleanup_new EXIT

# ============================================================================
# Step 4: Health check instance baru
# ============================================================================
log "🏥 Health checking new instance (max ${HEALTH_TIMEOUT}s)..."
ELAPSED=0
HEALTHY=0
while [ $ELAPSED -lt $HEALTH_TIMEOUT ]; do
  if ! kill -0 "$NEW_PID" 2>/dev/null; then
    fail "New instance died during startup. Check $LOG_DIR/green-instance.log"
  fi
  if curl -fsS -o /dev/null --max-time 2 "http://127.0.0.1:$PORT_NEW/api/v1/models" 2>/dev/null; then
    HEALTHY=1
    break
  fi
  sleep 2
  ELAPSED=$((ELAPSED + 2))
done

[ "$HEALTHY" = "1" ] || fail "New instance did not become healthy in ${HEALTH_TIMEOUT}s. Check $LOG_DIR/green-instance.log"
log "✅ New instance healthy after ${ELAPSED}s"

if [ -n "$BASELINE_DB_FINGERPRINT" ]; then
  CURRENT_DB_FINGERPRINT=$(db_fingerprint)
  [ "$CURRENT_DB_FINGERPRINT" = "$BASELINE_DB_FINGERPRINT" ] \
    || fail "Persistent data changed during green-instance validation; refusing cutover"
  grep -Fq "file: $DB_FILE" "$LOG_DIR/green-instance.log" \
    || fail "Green instance did not confirm the expected SQLite path; refusing cutover"
  log "✅ Data continuity verified before cutover"
fi

# ============================================================================
# Step 5: Port flip — kill old, promote new to live port
# ============================================================================
# Server gak bisa rebind port yang udah dipake, jadi urutannya:
#   a) Kill old instance (launchd akan auto-restart di PORT_LIVE — tapi kita gak mau itu,
#      jadi kita unload launchd dulu)
#   b) Kill new instance di PORT_NEW
#   c) Start new instance di PORT_LIVE via launchd (KeepAlive)
#
# Atau lebih sederhana: karena KeepAlive aktif, kita cukup:
#   a) Kill old — launchd langsung respawn fresh instance (dengan BUILD_ID baru)
#   b) Kill our temp new instance di PORT_NEW (cleanup)
#
# Cara ini lebih robust karena launchd tetap single source of truth.

log "🔄 Switching to new build..."

# Kill temp green instance dulu — kita gak butuh dia lagi, dia cuma buat verify build sehat
cleanup_new
trap - EXIT

if [ -n "$OLD_PID" ]; then
  log "🔪 Killing old instance (PID $OLD_PID) — launchd will respawn with new build"
  kill "$OLD_PID" 2>/dev/null || true

  # Wait for launchd to respawn
  log "⏳ Waiting for launchd to respawn healthy instance..."
  ELAPSED=0
  RESPAWNED=0
  while [ $ELAPSED -lt $HEALTH_TIMEOUT ]; do
    NEW_LIVE_PID=$(lsof -ti :$PORT_LIVE -sTCP:LISTEN 2>/dev/null | head -1 || true)
    if [ -n "$NEW_LIVE_PID" ] && [ "$NEW_LIVE_PID" != "$OLD_PID" ]; then
      if curl -fsS -o /dev/null --max-time 2 "http://127.0.0.1:$PORT_LIVE/api/v1/models" 2>/dev/null; then
        RESPAWNED=1
        log "✅ New live instance healthy: PID $NEW_LIVE_PID on port $PORT_LIVE (took ${ELAPSED}s)"
        break
      fi
    fi
    sleep 2
    ELAPSED=$((ELAPSED + 2))
  done

  [ "$RESPAWNED" = "1" ] || fail "launchd did not respawn healthy instance in ${HEALTH_TIMEOUT}s. Check $LOG_DIR/launchd.error.log"
else
  log "🚀 Starting 9Router via launchd for the first time"
  launchctl load "$HOME/Library/LaunchAgents/$LAUNCHD_LABEL.plist" 2>/dev/null || true
  sleep 3
  NEW_LIVE_PID=$(lsof -ti :$PORT_LIVE -sTCP:LISTEN 2>/dev/null | head -1 || true)
  [ -n "$NEW_LIVE_PID" ] || fail "Failed to start via launchd"
  log "✅ Started: PID $NEW_LIVE_PID on port $PORT_LIVE"
fi

log "🎉 Safe restart complete — 9Router is live with the latest build"
