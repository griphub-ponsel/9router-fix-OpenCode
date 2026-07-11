import fs from "fs";
import path from "path";
import { execFileSync, spawn, spawnSync } from "child_process";
import { DATA_DIR } from "@/lib/dataDir.js";
import {
  EXTRA_MARKERS,
  findHeadroomBinary,
  findPython310,
  getInstalledHeadroomExtras,
  HEADROOM_COMPRESSION_EXTRAS,
} from "./detect.js";

const HEADROOM_DIR = path.join(DATA_DIR, "headroom");
const PID_FILE = path.join(HEADROOM_DIR, "proxy.pid");
const LOG_FILE = path.join(HEADROOM_DIR, "proxy.log");
const INSTALL_LOG_FILE = path.join(HEADROOM_DIR, "install.log");
const DEFAULT_PORT = 8787;
const STARTUP_TIMEOUT_MS = 8000;

function ensureDir() {
  if (!fs.existsSync(HEADROOM_DIR)) fs.mkdirSync(HEADROOM_DIR, { recursive: true });
}

function readPid() {
  try {
    if (fs.existsSync(PID_FILE)) return parseInt(fs.readFileSync(PID_FILE, "utf8"), 10);
  } catch { /* ignore */ }
  return null;
}

function writePid(pid) {
  ensureDir();
  fs.writeFileSync(PID_FILE, String(pid));
}

function clearPid() {
  try { if (fs.existsSync(PID_FILE)) fs.unlinkSync(PID_FILE); } catch { /* ignore */ }
}

// process.kill throws if pid is dead — use this to probe.
export function isPidAlive(pid) {
  if (!pid || typeof pid !== "number") return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

export function getManagedPid() {
  const pid = readPid();
  return pid && isPidAlive(pid) ? pid : null;
}

function extrasProxyArgs({ codeAware, kompress } = {}) {
  const args = [];
  if (codeAware) args.push("--code-aware");
  if (kompress === false) args.push("--disable-kompress");
  return args;
}

export async function startHeadroomProxy({ port = DEFAULT_PORT, codeAware = false, kompress = true } = {}) {
  const safePort = Number(port) > 0 && Number(port) < 65536 ? Number(port) : DEFAULT_PORT;
  const binary = findHeadroomBinary();
  if (!binary) {
    const err = new Error("Headroom CLI not installed");
    err.code = "NOT_INSTALLED";
    throw err;
  }

  const existing = getManagedPid();
  if (existing) return { pid: existing, alreadyRunning: true };

  ensureDir();
  // spawn stdio requires fd numbers, not WriteStream objects.
  const outFd = fs.openSync(LOG_FILE, "a");

  const child = spawn(binary, [
    "proxy",
    "--port",
    String(safePort),
    ...extrasProxyArgs({ codeAware, kompress }),
  ], {
    stdio: ["ignore", outFd, outFd],
    detached: true,
    windowsHide: true,
    env: { ...process.env },
  });

  if (!child.pid) {
    fs.closeSync(outFd);
    const err = new Error("Failed to spawn headroom proxy");
    err.code = "SPAWN_FAILED";
    throw err;
  }

  child.unref();
  writePid(child.pid);

  // Wait until the process either stays alive briefly (success) or exits fast (failure).
  await new Promise((resolve, reject) => {
    const startupTimer = setTimeout(() => {
      if (isPidAlive(child.pid)) resolve();
      else reject(new Error("headroom proxy exited during startup — see proxy.log"));
    }, STARTUP_TIMEOUT_MS);

    child.once("exit", (code) => {
      clearTimeout(startupTimer);
      clearPid();
      fs.closeSync(outFd);
      const e = new Error(`headroom proxy exited early (code=${code}) — see proxy.log`);
      e.code = "EARLY_EXIT";
      reject(e);
    });
  });

  // Close parent's copy of the fd; child retains its own after unref.
  fs.closeSync(outFd);

  return { pid: child.pid, alreadyRunning: false };
}

export function stopHeadroomProxy() {
  const pid = getManagedPid();
  if (!pid) return { stopped: false, reason: "not_running" };
  try {
    if (process.platform === "win32") {
      execFileSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
    } else {
      process.kill(pid, "SIGTERM");
    }
    // Give it a moment, then force if still alive.
    if (process.platform !== "win32") setTimeout(() => {
      if (isPidAlive(pid)) {
        try { process.kill(pid, "SIGKILL"); } catch { /* already gone */ }
      }
    }, 2000);
    clearPid();
    return { stopped: true, pid };
  } catch (e) {
    clearPid();
    const err = new Error(`Failed to stop headroom proxy: ${e.message}`);
    err.code = "STOP_FAILED";
    throw err;
  }
}

export async function restartHeadroomProxy(options = {}) {
  stopHeadroomProxy();
  const deadline = Date.now() + 3000;
  while (getManagedPid() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return startHeadroomProxy(options);
}

export function getHeadroomLogTail(maxLines = 200) {
  try {
    if (!fs.existsSync(LOG_FILE)) return "";
    const content = fs.readFileSync(LOG_FILE, "utf8");
    const lines = content.split(/\r?\n/).filter(Boolean);
    return lines.slice(-maxLines).join("\n");
  } catch { return ""; }
}

function validateExtras(extras) {
  return Array.isArray(extras)
    ? [...new Set(extras.filter((extra) => HEADROOM_COMPRESSION_EXTRAS.includes(extra)))]
    : [];
}

function runPip(args, failureCode) {
  const python = findPython310();
  if (!python) {
    const error = new Error("Python >= 3.10 not found");
    error.code = "NO_PYTHON";
    throw error;
  }

  ensureDir();
  const outputFd = fs.openSync(INSTALL_LOG_FILE, "w");
  const child = spawn(python, ["-m", "pip", ...args], {
    stdio: ["ignore", outputFd, outputFd],
    windowsHide: true,
    env: { ...process.env },
  });

  return new Promise((resolve, reject) => {
    let settled = false;
    const closeFd = () => {
      try { fs.closeSync(outputFd); } catch { /* already closed */ }
    };
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      closeFd();
      reject(error);
    });
    child.once("exit", (code) => {
      if (settled) return;
      settled = true;
      closeFd();
      if (code === 0) resolve({ python, code });
      else {
        const error = new Error(`pip exited with code=${code} — see headroom/install.log`);
        error.code = failureCode;
        reject(error);
      }
    });
  });
}

function findUv() {
  const result = spawnSync(process.platform === "win32" ? "where.exe" : "which", ["uv"], {
    encoding: "utf8",
    windowsHide: true,
  });
  return result.status === 0 ? result.stdout.trim().split(/\r?\n/)[0] : null;
}

function isUvToolHeadroom(binary) {
  if (!binary) return false;
  const normalized = binary.replaceAll("\\", "/").toLowerCase();
  return normalized.includes("/.local/bin/headroom") || normalized.includes("/uv/tools/headroom-ai/");
}

function runUvToolInstall(spec) {
  const uv = findUv();
  if (!uv) return null;
  ensureDir();
  const outputFd = fs.openSync(INSTALL_LOG_FILE, "w");
  const child = spawn(uv, ["tool", "install", "--force", spec], {
    stdio: ["ignore", outputFd, outputFd],
    windowsHide: true,
    env: { ...process.env },
  });
  return new Promise((resolve, reject) => {
    child.once("error", (error) => { try { fs.closeSync(outputFd); } catch {} reject(error); });
    child.once("exit", (code) => {
      try { fs.closeSync(outputFd); } catch {}
      if (code === 0) resolve({ code, installer: "uv tool" });
      else {
        const error = new Error(`uv tool exited with code=${code} — see headroom/install.log`);
        error.code = "INSTALL_FAILED";
        reject(error);
      }
    });
  });
}

export async function installHeadroomExtras(extras = []) {
  const requested = validateExtras(extras);
  const binary = findHeadroomBinary();
  if (!binary) {
    const error = new Error("headroom-ai not installed (run `pip install headroom-ai[proxy]` first)");
    error.code = "NOT_INSTALLED";
    throw error;
  }
  const current = getInstalledHeadroomExtras(findPython310()).extras || {};
  const selected = HEADROOM_COMPRESSION_EXTRAS.filter((extra) => requested.includes(extra) || current[extra]);
  const spec = `headroom-ai[${["proxy", ...selected].join(",")}]`;
  const uvResult = isUvToolHeadroom(binary) ? await runUvToolInstall(spec) : null;
  const result = uvResult || await runPip(["install", "--upgrade", spec], "INSTALL_FAILED");
  return { success: true, ...result, spec, requested, ...getInstalledHeadroomExtras(result.python) };
}

export async function uninstallHeadroomExtras(extras = []) {
  const requested = validateExtras(extras);
  const packages = [...new Set(requested.flatMap((extra) => EXTRA_MARKERS[extra] || []))];
  if (packages.length === 0) {
    const error = new Error("No valid extras to remove");
    error.code = "INVALID_EXTRAS";
    throw error;
  }
  const { python, code } = await runPip(["uninstall", "-y", ...packages], "UNINSTALL_FAILED");
  return { success: true, code, removed: packages, requested, ...getInstalledHeadroomExtras(python) };
}

export function getInstallLogTail(maxLines = 15) {
  try {
    if (!fs.existsSync(INSTALL_LOG_FILE)) return "";
    const lines = fs.readFileSync(INSTALL_LOG_FILE, "utf8").split(/\r?\n/).filter(Boolean);
    return lines.slice(-maxLines).join("\n");
  } catch { return ""; }
}
