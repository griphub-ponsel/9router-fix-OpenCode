/**
 * Autostart manager: enable/disable launching 9router on OS boot.
 *
 * ESM port of cli/src/cli/tray/autostart.js so it can be called from Next.js
 * API routes. Implementation is per-platform:
 *
 *   macOS  - write a LaunchAgent plist under ~/Library/LaunchAgents and
 *            register it with launchctl.
 *   Windows - drop a .vbs shim in the user's Startup folder so the server
 *             starts hidden (no console window) at login.
 *   Linux   - write a .desktop file under ~/.config/autostart.
 *
 * The launched command is `<node> <cli-script> --tray --skip-update` so the
 * background instance hides itself in the system tray (when supported) and
 * skips the npm update check that would otherwise block startup.
 *
 * Path resolution (`resolveCliScript`) is deliberately defensive: when the
 * dashboard is served by `npm i -g 9router`'s cli.js we want autostart to
 * launch *that same* script, not the dev `bin/9router.js`. Falls back to
 * argv[1] then to bin/9router.js so dev mode still works.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync } from "node:child_process";

const APP_NAME = "9router";
const APP_LABEL = "com.9router.autostart";

/**
 * Resolve the absolute path to the CLI script that autostart should launch.
 * Returns null if no usable script is found. Callers must handle this so we
 * don't write a broken autostart entry pointing at a non-existent file.
 */
function resolveCliScript() {
  // Prefer the script that started this process. It's already validated to
  // exist and matches whatever the user chose to run (global cli.js, dev
  // bin/9router.js, etc.).
  const argv1 = process.argv[1];
  if (argv1) {
    const resolved = path.resolve(argv1);
    const base = path.basename(resolved);
    if (
      (base === "cli.js" || base === "9router.js" || base === "server.js") &&
      fs.existsSync(resolved)
    ) {
      // server.js is the Next standalone entry. Autostart should target the
      // user-facing wrapper instead so the TUI/tray still load. Walk up to
      // find bin/9router.js.
      if (base === "server.js") {
        const repoRoot = path.resolve(path.dirname(resolved), "..", "..");
        const wrapper = path.join(repoRoot, "bin", "9router.js");
        if (fs.existsSync(wrapper)) return wrapper;
      } else {
        return resolved;
      }
    }
  }

  // Fall back to the bin wrapper shipped with this repo. cwd is set by the
  // Next dev server / standalone runner, so this works in both modes.
  const cwdWrapper = path.resolve(process.cwd(), "bin", "9router.js");
  if (fs.existsSync(cwdWrapper)) return cwdWrapper;

  return null;
}

function isSupportedPlatform() {
  const p = process.platform;
  if (!["darwin", "win32", "linux"].includes(p)) return false;
  // Linux without a graphical session has no autostart concept users would
  // recognise, skip rather than write a .desktop that nothing reads.
  if (p === "linux" && !process.env.DISPLAY) return false;
  return true;
}

/**
 * Check whether autostart is currently enabled.
 *
 * On macOS we require BOTH the plist file and a successful `launchctl list`
 * The plist alone could exist with launchd in a failed state, and the UI
 * should not claim "Enabled" in that case.
 */
export function isAutoStartEnabled() {
  if (!isSupportedPlatform()) return false;
  try {
    if (process.platform === "darwin") {
      const plistPath = path.join(
        os.homedir(),
        "Library",
        "LaunchAgents",
        `${APP_LABEL}.plist`
      );
      if (!fs.existsSync(plistPath)) return false;
      try {
        execSync(`launchctl list ${APP_LABEL}`, {
          stdio: ["ignore", "ignore", "ignore"],
          timeout: 3000,
        });
        return true;
      } catch {
        return false;
      }
    }
    if (process.platform === "win32") {
      const startupPath = path.join(
        process.env.APPDATA || "",
        "Microsoft",
        "Windows",
        "Start Menu",
        "Programs",
        "Startup",
        `${APP_NAME}.vbs`
      );
      return fs.existsSync(startupPath);
    }
    if (process.platform === "linux") {
      const desktopPath = path.join(
        os.homedir(),
        ".config",
        "autostart",
        `${APP_NAME}.desktop`
      );
      return fs.existsSync(desktopPath);
    }
  } catch {
    // best-effort: treat any unexpected failure as "not enabled" so the UI
    // shows a safe default instead of throwing.
  }
  return false;
}

export function getAutoStartStatus() {
  return {
    supported: isSupportedPlatform(),
    enabled: isAutoStartEnabled(),
    platform: process.platform,
    cliScript: resolveCliScript(),
  };
}

export function enableAutoStart() {
  if (!isSupportedPlatform()) {
    return { success: false, error: "Platform not supported" };
  }
  const cliScript = resolveCliScript();
  if (!cliScript) {
    return { success: false, error: "Cannot resolve CLI script path" };
  }

  try {
    if (process.platform === "darwin") return enableMacOS(cliScript);
    if (process.platform === "win32") return enableWindows(cliScript);
    if (process.platform === "linux") return enableLinux(cliScript);
  } catch (err) {
    return { success: false, error: err?.message || String(err) };
  }
  return { success: false, error: "Platform not supported" };
}

export function disableAutoStart() {
  if (!isSupportedPlatform()) {
    return { success: false, error: "Platform not supported" };
  }
  try {
    if (process.platform === "darwin") return disableMacOS();
    if (process.platform === "win32") return disableWindows();
    if (process.platform === "linux") return disableLinux();
  } catch (err) {
    return { success: false, error: err?.message || String(err) };
  }
  return { success: false, error: "Platform not supported" };
}

// ============ macOS ============

function enableMacOS(cliScript) {
  const launchAgentsDir = path.join(os.homedir(), "Library", "LaunchAgents");
  const plistPath = path.join(launchAgentsDir, `${APP_LABEL}.plist`);

  if (!fs.existsSync(launchAgentsDir)) {
    fs.mkdirSync(launchAgentsDir, { recursive: true });
  }

  const nodePath = process.execPath;
  // Explicit PATH so children spawned by cli.js (npm install at runtime, etc.)
  // can resolve binaries when launched from a non-interactive launchd context.
  const launchPath = `${path.dirname(nodePath)}:/usr/local/bin:/usr/bin:/bin`;

  const plistContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${APP_LABEL}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${nodePath}</string>
        <string>${cliScript}</string>
        <string>--tray</string>
        <string>--skip-update</string>
    </array>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>${launchPath}</string>
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <false/>
    <key>StandardOutPath</key>
    <string>/tmp/9router.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/9router.error.log</string>
</dict>
</plist>`;

  fs.writeFileSync(plistPath, plistContent);

  // Best-effort registration. Even if launchctl fails, the plist file is on
  // disk and will be picked up at next login.
  try {
    execSync(`launchctl unload "${plistPath}"`, { stdio: "ignore" });
  } catch {}
  try {
    execSync(`launchctl load -w "${plistPath}"`, { stdio: "ignore" });
  } catch {}
  return { success: true };
}

function disableMacOS() {
  const plistPath = path.join(
    os.homedir(),
    "Library",
    "LaunchAgents",
    `${APP_LABEL}.plist`
  );
  try {
    execSync(`launchctl unload "${plistPath}"`, { stdio: "ignore" });
  } catch {}
  if (fs.existsSync(plistPath)) {
    fs.unlinkSync(plistPath);
  }
  return { success: true };
}

// ============ Windows ============

function enableWindows(cliScript) {
  const startupDir = path.join(
    process.env.APPDATA || "",
    "Microsoft",
    "Windows",
    "Start Menu",
    "Programs",
    "Startup"
  );
  const vbsPath = path.join(startupDir, `${APP_NAME}.vbs`);

  if (!fs.existsSync(startupDir)) {
    return {
      success: false,
      error: "Startup folder not found - Windows profile may be misconfigured",
    };
  }

  const nodePath = process.execPath;
  // VBS wrapper runs node + cli.js in a hidden window (0 = hide). False at the
  // end means don't wait, return immediately so login proceeds normally.
  const vbsContent = `Set WshShell = CreateObject("WScript.Shell")
WshShell.Run """${nodePath}"" ""${cliScript}"" --tray --skip-update", 0, False
`;
  fs.writeFileSync(vbsPath, vbsContent);
  return { success: true };
}

function disableWindows() {
  const vbsPath = path.join(
    process.env.APPDATA || "",
    "Microsoft",
    "Windows",
    "Start Menu",
    "Programs",
    "Startup",
    `${APP_NAME}.vbs`
  );
  if (fs.existsSync(vbsPath)) {
    fs.unlinkSync(vbsPath);
  }
  return { success: true };
}

// ============ Linux ============

function enableLinux(cliScript) {
  const autostartDir = path.join(os.homedir(), ".config", "autostart");
  const desktopPath = path.join(autostartDir, `${APP_NAME}.desktop`);

  if (!fs.existsSync(autostartDir)) {
    fs.mkdirSync(autostartDir, { recursive: true });
  }

  const nodePath = process.execPath;
  const desktopContent = `[Desktop Entry]
Type=Application
Name=9Router
Comment=9Router API Proxy
Exec=${nodePath} ${cliScript} --tray --skip-update
Hidden=false
NoDisplay=false
X-GNOME-Autostart-enabled=true
`;
  fs.writeFileSync(desktopPath, desktopContent);
  return { success: true };
}

function disableLinux() {
  const desktopPath = path.join(
    os.homedir(),
    ".config",
    "autostart",
    `${APP_NAME}.desktop`
  );
  if (fs.existsSync(desktopPath)) {
    fs.unlinkSync(desktopPath);
  }
  return { success: true };
}
