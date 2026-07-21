#!/usr/bin/env python3
"""Reliably restart production 9Router through its persistent launchd owner.

This script never spawns a standalone Node replacement and never loops. It
loads the permanent LaunchAgent when needed, performs exactly one kickstart,
and waits for a different launchd PID plus a healthy HTTP response.
"""

from __future__ import annotations

import argparse
import fcntl
import json
import os
import plistlib
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

LABEL = "ai.9router.gateway"
PORT = 20128
ROOT = Path("/Users/macmini/9router-vite-migration")
PLIST = Path.home() / "Library/LaunchAgents/ai.9router.gateway.plist"
SERVER_ENTRY = ROOT / "dist-server/index.js"
CLIENT_ENTRY = ROOT / "dist/index.html"
LOG_DIR = ROOT / ".logs"
LOCK_FILE = Path.home() / ".9router/restart.lock"


def build_restart_command(uid: int, label: str = LABEL) -> list[str]:
    return ["launchctl", "kickstart", "-k", f"gui/{uid}/{label}"]


def is_health_payload_ok(payload: bytes) -> bool:
    try:
        value = json.loads(payload)
    except (json.JSONDecodeError, UnicodeDecodeError):
        return False
    return isinstance(value, dict) and value.get("ok") is True


def parse_launchd_pid(output: str) -> int | None:
    for line in output.splitlines():
        stripped = line.strip()
        if stripped.startswith("pid ="):
            value = stripped.partition("=")[2].strip()
            return int(value) if value.isdigit() else None
    return None


def restart_completed(old_pid: int | None, new_pid: int | None, healthy: bool) -> bool:
    return new_pid is not None and new_pid != old_pid and healthy


def run(command: list[str], *, check: bool = True) -> subprocess.CompletedProcess[str]:
    return subprocess.run(command, check=check, capture_output=True, text=True)


def service_target(uid: int) -> str:
    return f"gui/{uid}/{LABEL}"


def service_output(uid: int) -> str | None:
    result = run(["launchctl", "print", service_target(uid)], check=False)
    return result.stdout if result.returncode == 0 else None


def current_pid(uid: int) -> int | None:
    output = service_output(uid)
    return parse_launchd_pid(output) if output else None


def validate_files() -> None:
    missing = [path for path in (PLIST, SERVER_ENTRY, CLIENT_ENTRY) if not path.is_file()]
    if missing:
        raise RuntimeError("Missing required production file(s): " + ", ".join(map(str, missing)))
    with PLIST.open("rb") as handle:
        config = plistlib.load(handle)
    if config.get("Label") != LABEL:
        raise RuntimeError(f"Unexpected plist label: {config.get('Label')!r}")
    if config.get("KeepAlive") is not True or config.get("RunAtLoad") is not True:
        raise RuntimeError("LaunchAgent must have KeepAlive=true and RunAtLoad=true")
    args = config.get("ProgramArguments") or []
    if str(SERVER_ENTRY) not in args:
        raise RuntimeError(f"LaunchAgent does not run {SERVER_ENTRY}")
    env = config.get("EnvironmentVariables") or {}
    if env.get("NODE_ENV") != "production" or str(env.get("PORT")) != str(PORT):
        raise RuntimeError("LaunchAgent must use NODE_ENV=production and PORT=20128")


def ensure_loaded(uid: int) -> None:
    if service_output(uid) is not None:
        return
    result = run(["launchctl", "load", "-w", str(PLIST)], check=False)
    if result.returncode != 0 and service_output(uid) is None:
        detail = (result.stderr or result.stdout).strip()
        raise RuntimeError(f"Could not load {LABEL}: {detail}")


def health_ok() -> bool:
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{PORT}/api/health", timeout=2) as response:
            return response.status == 200 and is_health_payload_ok(response.read())
    except (urllib.error.URLError, TimeoutError, OSError):
        return False


def log_tail(path: Path, lines: int = 20) -> str:
    try:
        return "\n".join(path.read_text(errors="replace").splitlines()[-lines:])
    except OSError:
        return "(log unavailable)"


def restart(timeout: float) -> int:
    uid = os.getuid()
    validate_files()
    LOCK_FILE.parent.mkdir(parents=True, exist_ok=True)
    LOG_DIR.mkdir(parents=True, exist_ok=True)

    with LOCK_FILE.open("w") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            raise RuntimeError("Another 9Router restart is already running") from exc

        ensure_loaded(uid)
        old_pid = current_pid(uid)
        command = build_restart_command(uid)
        print(f"Restarting {LABEL} once (old PID: {old_pid or 'none'})")
        result = run(command, check=False)
        if result.returncode != 0:
            detail = (result.stderr or result.stdout).strip()
            raise RuntimeError(f"launchctl kickstart failed: {detail}")

        deadline = time.monotonic() + timeout
        observed_pid = None
        while time.monotonic() < deadline:
            observed_pid = current_pid(uid)
            if restart_completed(old_pid, observed_pid, health_ok()):
                assert observed_pid is not None
                print(f"9Router healthy on :{PORT} (new PID: {observed_pid})")
                return observed_pid
            time.sleep(0.5)

        errors = log_tail(LOG_DIR / "launchd.error.log")
        raise RuntimeError(
            f"9Router did not restart healthy within {timeout:.0f}s "
            f"(old PID={old_pid}, observed PID={observed_pid}).\n"
            f"Last launchd errors:\n{errors}"
        )


def check_status() -> int:
    uid = os.getuid()
    validate_files()
    pid = current_pid(uid)
    healthy = health_ok()
    print(json.dumps({
        "label": LABEL,
        "loaded": service_output(uid) is not None,
        "pid": pid,
        "port": PORT,
        "healthy": healthy,
        "mode": "production",
    }))
    return 0 if pid and healthy else 1


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Validate files and report status without restarting")
    parser.add_argument("--timeout", type=float, default=45.0, help="Seconds to wait for a healthy new PID")
    args = parser.parse_args()
    if args.timeout <= 0:
        parser.error("--timeout must be positive")
    try:
        return check_status() if args.check else (restart(args.timeout) and 0)
    except (RuntimeError, OSError, subprocess.SubprocessError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
