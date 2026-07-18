#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const cliDir = path.resolve(__dirname, "..");
const appDir = path.resolve(cliDir, "..");
const rootDir = path.resolve(appDir, "..");
const cliAppDir = process.env.NINEROUTER_CLI_APP_DIR || path.join(cliDir, "app");
const buildHomeDir = path.join(cliDir, ".build-home");

// Exclude patterns for files/folders we don't want to copy
const EXCLUDE_PATTERNS = [
  "@img",           // Sharp image processing (not needed with unoptimized images)
  "sharp",          // Sharp core lib (not needed with unoptimized images)
  "detect-libc",    // Sharp dependency
  ".env",           // Environment files
  ".env.local",
  ".env.*.local",
  "*.log",          // Log files
  "tmp",            // Temp files
  ".DS_Store",      // macOS files
];

function shouldExclude(name) {
  return EXCLUDE_PATTERNS.some(pattern => {
    if (pattern.includes("*")) {
      const regex = new RegExp("^" + pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$");
      return regex.test(name);
    }
    return name === pattern;
  });
}

function copyRecursive(src, dest) {
  if (!fs.existsSync(src)) {
    console.warn(`Warning: Source ${src} does not exist`);
    return;
  }
  
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }

  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    if (shouldExclude(entry.name)) {
      continue;
    }

    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    // Skip broken symlinks (common in workspace setups)
    try {
      fs.accessSync(srcPath);
    } catch {
      continue;
    }

    if (entry.isDirectory()) {
      copyRecursive(srcPath, destPath);
    } else if (entry.isSymbolicLink()) {
      // Resolve and copy target (avoid linking outside bundle)
      try {
        const real = fs.realpathSync(srcPath);
        if (fs.statSync(real).isDirectory()) {
          copyRecursive(real, destPath);
        } else {
          fs.copyFileSync(real, destPath);
        }
      } catch {}
    } else {
      try {
        fs.copyFileSync(srcPath, destPath);
      } catch {}
    }
  }
}

function cleanDirectoryContents(dir) {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    try {
      fs.rmSync(entryPath, { recursive: true, force: true });
    } catch (error) {
      const code = error && error.code ? error.code : "UNKNOWN";
      // Keep build moving when a watcher/tray process still holds a handle.
      if (code === "EBUSY" || code === "EPERM") {
        console.warn(`⚠️  Could not remove locked path: ${entryPath} (${code})`);
        continue;
      }
      throw error;
    }
  }
}

function removeDirForRebuild(dir) {
  if (!fs.existsSync(dir)) return;
  try {
    fs.rmSync(dir, { recursive: true, force: true });
    return;
  } catch (error) {
    const code = error && error.code ? error.code : "UNKNOWN";
    if (code !== "EBUSY" && code !== "EPERM" && code !== "ENOTEMPTY") {
      throw error;
    }

    console.warn(`⚠️  Could not remove ${dir} (${code}); cleaning contents instead...`);
    cleanDirectoryContents(dir);
  }
}

console.log("📦 Building 9Router CLI package...\n");

fs.mkdirSync(buildHomeDir, { recursive: true });
fs.mkdirSync(path.join(buildHomeDir, "AppData", "Roaming"), { recursive: true });
fs.mkdirSync(path.join(buildHomeDir, "AppData", "Local"), { recursive: true });

// Step 0: Sync version from app/cli/package.json to app/package.json
console.log("0️⃣  Syncing version to app/package.json...");
const cliPkg = JSON.parse(fs.readFileSync(path.join(cliDir, "package.json"), "utf8"));
const appPkgPath = path.join(appDir, "package.json");
const appPkg = JSON.parse(fs.readFileSync(appPkgPath, "utf8"));
if (appPkg.version !== cliPkg.version) {
  appPkg.version = cliPkg.version;
  fs.writeFileSync(appPkgPath, JSON.stringify(appPkg, null, 2) + "\n");
  console.log(`✅ Version synced: ${cliPkg.version}\n`);
} else {
  console.log(`✅ Version already synced: ${cliPkg.version}\n`);
}

// Step 1: Build the Vite client and Express API server.
console.log("1️⃣  Building application...");
try {
  execSync("npm run build", {
    stdio: "inherit",
    cwd: appDir,
    env: {
      ...process.env,
      HOME: buildHomeDir,
      USERPROFILE: buildHomeDir,
      APPDATA: path.join(buildHomeDir, "AppData", "Roaming"),
      LOCALAPPDATA: path.join(buildHomeDir, "AppData", "Local"),
    }
  });
  console.log("✅ Application build completed\n");
} catch (error) {
  console.error("❌ Application build failed");
  process.exit(1);
}

// Step 2: Clean old app/cli/app if exists
console.log("2️⃣  Cleaning old app/cli/app...");
removeDirForRebuild(cliAppDir);
fs.mkdirSync(cliAppDir, { recursive: true });
console.log("✅ Cleaned\n");

// Step 3: Copy the Vite client and bundled Express server.
console.log("3️⃣  Copying production build to app/cli/app...");
for (const directory of ["dist", "dist-server"]) {
  const source = path.join(appDir, directory);
  if (!fs.existsSync(source)) {
    console.error(`❌ ${directory} build output not found`);
    process.exit(1);
  }
  copyRecursive(source, path.join(cliAppDir, directory));
}
if (!fs.existsSync(path.join(cliAppDir, "dist-server", "index.js"))) {
  console.error("❌ dist-server/index.js not found");
  process.exit(1);
}
console.log("✅ Copied production build\n");

// Step 3b: Bundle runtime dependencies required by the external server build.
// Strip better-sqlite3 (native) — it lives in ~/.9router/runtime to avoid
// Windows EBUSY during global CLI updates. node:sqlite (Node ≥22.5) is also
// available as a no-install middle tier.
console.log("3️⃣ b Installing production runtime dependencies...");
const runtimeDependenciesPath = path.join(appDir, "dist-server", "runtime-dependencies.json");
if (!fs.existsSync(runtimeDependenciesPath)) {
  console.error("❌ dist-server/runtime-dependencies.json not found");
  process.exit(1);
}
const runtimeDependencies = JSON.parse(fs.readFileSync(runtimeDependenciesPath, "utf8"));
delete runtimeDependencies["better-sqlite3"];
const runtimePackage = {
  private: true,
  dependencies: runtimeDependencies,
};
fs.writeFileSync(path.join(cliAppDir, "package.json"), JSON.stringify(runtimePackage, null, 2) + "\n");
try {
  execSync("npm install --omit=dev --ignore-scripts --legacy-peer-deps --no-audit --no-fund", {
    stdio: "inherit",
    cwd: cliAppDir,
  });
} catch {
  console.error("❌ Failed to install production runtime dependencies");
  process.exit(1);
}
function ensureModuleInBundle(pkg) {
  const dest = path.join(cliAppDir, "node_modules", pkg);
  if (fs.existsSync(dest)) {
    console.log(`✅ ${pkg} already bundled`);
    return;
  }
  const candidates = [
    path.join(appDir, "node_modules", pkg),
    path.join(rootDir, "node_modules", pkg),
  ];
  const src = candidates.find((p) => fs.existsSync(p));
  if (!src) {
    console.warn(`⚠️  ${pkg} not found locally — bundle will rely on node:sqlite or runtime install`);
    return;
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  copyRecursive(src, dest);
  console.log(`✅ Bundled ${pkg}`);
}
ensureModuleInBundle("sql.js");
const betterDir = path.join(cliAppDir, "node_modules", "better-sqlite3");
if (fs.existsSync(betterDir)) {
  fs.rmSync(betterDir, { recursive: true, force: true });
  console.log("✅ Stripped better-sqlite3 (lives in ~/.9router/runtime)");
}
console.log("");

// Step 4: Copy MITM server files.
console.log("4️⃣  Copying MITM server files...");
const mitmSrc = path.join(appDir, "src", "mitm");
const mitmDest = path.join(cliAppDir, "src", "mitm");
if (fs.existsSync(mitmSrc)) {
  copyRecursive(mitmSrc, mitmDest);
  console.log("✅ Copied MITM files\n");
} else {
  console.log("⏭️  No MITM files found\n");
}

// Step 4b: Copy standalone updater (headless Node process for install progress)
console.log("4️⃣ b Copying updater files...");
const updaterSrc = path.join(appDir, "src", "lib", "updater");
const updaterDest = path.join(cliAppDir, "src", "lib", "updater");
if (fs.existsSync(updaterSrc)) {
  copyRecursive(updaterSrc, updaterDest);
  console.log("✅ Copied updater files\n");
} else {
  console.log("⏭️  No updater files found\n");
}

// Step 5: Build MITM server (config driven - see app/cli/scripts/buildMitm.js)
console.log("5️⃣  Building MITM server...");
try {
  execSync("node scripts/buildMitm.js", { stdio: "inherit", cwd: cliDir });
  console.log("✅ MITM server build completed\n");
} catch (error) {
  console.error("❌ MITM build failed");
  process.exit(1);
}

console.log("✨ CLI package build completed!");
console.log(`📁 Output: ${cliAppDir}`);

function getDirectorySize(dir) {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      total += getDirectorySize(entryPath);
    } else if (entry.isFile()) {
      total += fs.statSync(entryPath).size;
    }
  }
  return total;
}

function formatBytes(bytes) {
  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(unitIndex === 0 ? 0 : 1)}${units[unitIndex]}`;
}

if (fs.existsSync(cliAppDir)) {
  console.log(`📊 Package size: ${formatBytes(getDirectorySize(cliAppDir))}`);
}
