#!/bin/bash
set -euo pipefail

LABEL="ai.9router.gateway"
DOMAIN="gui/$(id -u)"
VITE_ROOT="/Users/macmini/9router-vite-migration"
LEGACY_ROOT="/Users/macmini/9router-griphub"
NODE_BIN="/Users/macmini/.local/share/fnm/node-versions/v22.23.1/installation/bin/node"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
DATA_DIR="${DATA_DIR:-$HOME/.9router}"
DB_FILE="$DATA_DIR/db/data.sqlite"
PORT=20128
GREEN_PORT=23130
RUN_ID="$(date '+%Y%m%d-%H%M%S')"
STATE_DIR="$DATA_DIR/cutover/$RUN_ID"
STATUS_FILE="$DATA_DIR/cutover/latest.status"
LOG_FILE="$STATE_DIR/cutover.log"
SERVICE_OUT="$VITE_ROOT/.logs/launchd.log"
SERVICE_ERR="$VITE_ROOT/.logs/launchd.error.log"
OLD_PLIST="$STATE_DIR/legacy.plist"
NEW_PLIST="$STATE_DIR/vite.plist"
BACKUP_DB="$DATA_DIR/db/backups/pre-vite-cutover-$RUN_ID.sqlite"
GREEN_DATA="$STATE_DIR/green-data"
LOCK_DIR="$DATA_DIR/cutover/.lock"
LEGACY_WAS_RUNNING=0
LEGACY_STOPPED=0
OLD_PGID=""
GREEN_PID=""
CUTOVER_COMMITTED=0

mkdir -p "$STATE_DIR" "$VITE_ROOT/.logs" "$DATA_DIR/db/backups" "$(dirname "$PLIST")"
exec > >(tee -a "$LOG_FILE") 2>&1

status() {
  local phase="$1" result="$2" detail="${3:-}"
  printf 'run_id=%s\nphase=%s\nresult=%s\ndetail=%s\nlog=%s\nupdated_at=%s\n' \
    "$RUN_ID" "$phase" "$result" "$detail" "$LOG_FILE" "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" > "$STATUS_FILE.tmp"
  mv "$STATUS_FILE.tmp" "$STATUS_FILE"
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $phase: $result $detail"
}

fail() {
  status "failed" "error" "$*"
  return 1
}

listener_pid() {
  lsof -ti :"$1" -sTCP:LISTEN 2>/dev/null | head -1 || true
}

health_ok() {
  curl -fsS -o /dev/null --max-time 3 "http://127.0.0.1:$1/api/health"
}

wait_healthy() {
  local port="$1" max="${2:-60}" elapsed=0
  while [ "$elapsed" -lt "$max" ]; do
    if health_ok "$port"; then return 0; fi
    sleep 2
    elapsed=$((elapsed + 2))
  done
  return 1
}

db_fingerprint() {
  python3 - "$DB_FILE" <<'PY'
import sqlite3, sys
con = sqlite3.connect(f"file:{sys.argv[1]}?mode=ro", uri=True)
tables = {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}
expected = ("settings", "providerConnections", "providerNodes", "proxyPools", "apiKeys", "combos", "kv")
parts=[]
for table in expected:
    if table in tables:
        parts.append(f"{table}={con.execute(f'SELECT COUNT(*) FROM {table}').fetchone()[0]}")
print(";".join(parts))
con.close()
PY
}

restore_legacy() {
  status "rollback" "running" "restoring previous launchd service"
  launchctl bootout "$DOMAIN/$LABEL" >/dev/null 2>&1 || true
  if [ -f "$OLD_PLIST" ]; then
    cp "$OLD_PLIST" "$PLIST"
    plutil -lint "$PLIST" >/dev/null
    launchctl bootstrap "$DOMAIN" "$PLIST" >/dev/null 2>&1 || true
    launchctl kickstart -k "$DOMAIN/$LABEL" >/dev/null 2>&1 || true
  elif [ "$LEGACY_WAS_RUNNING" = "1" ]; then
    (
      cd "$LEGACY_ROOT"
      PORT="$PORT" HOSTNAME=0.0.0.0 nohup npm run dev >> "$LEGACY_ROOT/.logs/rollback.log" 2>&1 &
    )
  fi
  if ! wait_healthy "$PORT" 45 && [ "$LEGACY_WAS_RUNNING" = "1" ]; then
    launchctl bootout "$DOMAIN/$LABEL" >/dev/null 2>&1 || true
    status "rollback" "running" "legacy plist did not recover; starting previous dev command"
    (
      cd "$LEGACY_ROOT"
      PORT="$PORT" HOSTNAME=0.0.0.0 nohup npm run dev >> "$LEGACY_ROOT/.logs/rollback.log" 2>&1 &
    )
  fi
  if wait_healthy "$PORT" 60; then
    status "rollback" "success" "legacy service healthy on port $PORT"
  else
    status "rollback" "failed" "manual recovery required; see $LOG_FILE"
  fi
}

cleanup() {
  if [ -n "$GREEN_PID" ] && kill -0 "$GREEN_PID" 2>/dev/null; then
    kill "$GREEN_PID" >/dev/null 2>&1 || true
  fi
  rmdir "$LOCK_DIR" >/dev/null 2>&1 || true
}

on_error() {
  local code=$?
  if [ "$CUTOVER_COMMITTED" != "1" ] && [ "$LEGACY_STOPPED" = "1" ]; then restore_legacy || true; fi
  cleanup
  exit "$code"
}
trap on_error ERR INT TERM
trap cleanup EXIT

mkdir "$LOCK_DIR" 2>/dev/null || fail "another cutover is already running"
status "preflight" "running" "checking production artifacts and persistent data"
[ -x "$NODE_BIN" ] || fail "Node binary missing: $NODE_BIN"
[ -f "$VITE_ROOT/dist/index.html" ] || fail "Vite client artifact missing"
[ -f "$VITE_ROOT/dist-server/index.js" ] || fail "Express server artifact missing"
[ -f "$DB_FILE" ] || fail "active SQLite database missing: $DB_FILE"
[ -f "$PLIST" ] && cp "$PLIST" "$OLD_PLIST"

BASELINE="$(db_fingerprint)"
[ -n "$BASELINE" ] || fail "could not fingerprint persistent database"
python3 - "$DB_FILE" "$BACKUP_DB" <<'PY'
import sqlite3, sys
source=sqlite3.connect(f"file:{sys.argv[1]}?mode=ro", uri=True)
target=sqlite3.connect(sys.argv[2])
source.backup(target)
target.close(); source.close()
PY
[ -s "$BACKUP_DB" ] || fail "SQLite backup failed"
status "preflight" "success" "backup=$BACKUP_DB fingerprint=$BASELINE"

mkdir -p "$GREEN_DATA/db"
cp "$BACKUP_DB" "$GREEN_DATA/db/data.sqlite"
status "green-check" "running" "starting Vite against isolated database backup on port $GREEN_PORT"
(
  cd "$VITE_ROOT"
  exec env DATA_DIR="$GREEN_DATA" PORT="$GREEN_PORT" HOSTNAME=127.0.0.1 NODE_ENV=production \
    "$NODE_BIN" dist-server/index.js >> "$STATE_DIR/green.log" 2>&1
) &
GREEN_PID=$!
wait_healthy "$GREEN_PORT" 60 || fail "green instance failed health check"
curl -fsS -o /dev/null --max-time 20 "http://127.0.0.1:$GREEN_PORT/v1/models" \
  || fail "green instance models endpoint failed"
DB_PATH_CONFIRMED=0
for _ in $(seq 1 20); do
  if grep -Fq "file: $GREEN_DATA/db/data.sqlite" "$STATE_DIR/green.log"; then DB_PATH_CONFIRMED=1; break; fi
  sleep 1
done
[ "$DB_PATH_CONFIRMED" = "1" ] || fail "green instance did not confirm isolated database path"
[ "$(db_fingerprint)" = "$BASELINE" ] || fail "persistent row counts changed during green check"
kill "$GREEN_PID" >/dev/null 2>&1 || true
wait "$GREEN_PID" 2>/dev/null || true
GREEN_PID=""
status "green-check" "success" "Vite runtime healthy with isolated backup; active database untouched"

python3 - "$NEW_PLIST" "$NODE_BIN" "$VITE_ROOT" "$SERVICE_OUT" "$SERVICE_ERR" "$DATA_DIR" <<'PY'
import plistlib, sys
out,node,root,stdout,stderr,data_dir=sys.argv[1:]
plist={
  "Label":"ai.9router.gateway",
  "ProgramArguments":[node, f"{root}/dist-server/index.js"],
  "WorkingDirectory":root,
  "EnvironmentVariables":{
    "PATH":f"{node.rsplit('/',1)[0]}:/Users/macmini/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin",
    "NODE_ENV":"production", "PORT":"20128", "HOSTNAME":"0.0.0.0", "DATA_DIR":data_dir,
  },
  "LimitLoadToSessionType":["Aqua","Background"],
  "RunAtLoad":True, "KeepAlive":True, "ThrottleInterval":5,
  "StandardOutPath":stdout, "StandardErrorPath":stderr,
}
with open(out,'wb') as f: plistlib.dump(plist,f,sort_keys=False)
PY
plutil -lint "$NEW_PLIST" >/dev/null

OLD_LISTENER="$(listener_pid "$PORT")"
if [ -n "$OLD_LISTENER" ]; then
  LEGACY_WAS_RUNNING=1
  OLD_COMMAND="$(ps -ww -o command= -p "$OLD_LISTENER" || true)"
  case "$OLD_COMMAND" in
    *next-server*|*9router-griphub*) ;;
    *) fail "refusing to stop unexpected listener PID $OLD_LISTENER: $OLD_COMMAND" ;;
  esac
  OLD_PGID="$(ps -o pgid= -p "$OLD_LISTENER" | tr -d ' ')"
fi

status "cutover" "running" "installing launchd Vite service"
launchctl bootout "$DOMAIN/$LABEL" >/dev/null 2>&1 || true
if [ -n "$OLD_PGID" ]; then
  LEGACY_STOPPED=1
  kill -TERM -- "-$OLD_PGID" >/dev/null 2>&1 || true
  for _ in $(seq 1 15); do [ -z "$(listener_pid "$PORT")" ] && break; sleep 1; done
  [ -z "$(listener_pid "$PORT")" ] || kill -KILL -- "-$OLD_PGID" >/dev/null 2>&1 || true
fi
cp "$NEW_PLIST" "$PLIST"
plutil -lint "$PLIST" >/dev/null
launchctl bootstrap "$DOMAIN" "$PLIST"
launchctl kickstart -k "$DOMAIN/$LABEL"
wait_healthy "$PORT" 60 || fail "Vite launchd service failed initial health check"
FIRST_PID="$(listener_pid "$PORT")"
[ -n "$FIRST_PID" ] || fail "Vite service has no listener"
FIRST_CMD="$(ps -ww -o command= -p "$FIRST_PID")"
case "$FIRST_CMD" in *dist-server/index.js*) ;; *) fail "unexpected production command: $FIRST_CMD" ;; esac
[ "$(db_fingerprint)" = "$BASELINE" ] || fail "persistent data mismatch after cutover"
status "cutover" "success" "initial Vite PID=$FIRST_PID"

status "keepalive-test" "running" "terminating first Vite PID to prove launchd auto-restart"
kill -TERM "$FIRST_PID"
SECOND_PID=""
for _ in $(seq 1 30); do
  SECOND_PID="$(listener_pid "$PORT")"
  if [ -n "$SECOND_PID" ] && [ "$SECOND_PID" != "$FIRST_PID" ] && health_ok "$PORT"; then break; fi
  sleep 2
done
[ -n "$SECOND_PID" ] && [ "$SECOND_PID" != "$FIRST_PID" ] || fail "launchd KeepAlive did not produce a new PID"
SECOND_CMD="$(ps -ww -o command= -p "$SECOND_PID")"
case "$SECOND_CMD" in *dist-server/index.js*) ;; *) fail "KeepAlive started unexpected command: $SECOND_CMD" ;; esac
[ "$(db_fingerprint)" = "$BASELINE" ] || fail "persistent data mismatch after KeepAlive restart"
launchctl print "$DOMAIN/$LABEL" > "$STATE_DIR/launchctl.txt"
CUTOVER_COMMITTED=1
status "complete" "success" "Vite live PID=$SECOND_PID port=$PORT backup=$BACKUP_DB"
trap - ERR INT TERM
cleanup
exit 0
