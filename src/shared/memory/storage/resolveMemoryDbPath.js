/**
 * Canonical resolver for 9router-memory.sqlite.
 *
 * Historical bug: SqliteAdapter used process.cwd() + relative `data/...`, so
 * CLI (cwd=cli/app), Next standalone, tests, and repo root each created their
 * own empty/partial DB. Always resolve to ONE absolute path.
 *
 * Priority:
 *  1. MEMORY_DB_PATH / MEMORY_STORAGE_DB_PATH env (absolute or relative)
 *  2. Absolute config.dbPath
 *  3. Repo-root `data/9router-memory.sqlite` (found by walking from __dirname)
 *  4. `{DATA_DIR|/APPDATA/9router}/9router-memory.sqlite`
 */

const fs = require("fs");
const path = require("path");
const os = require("os");

const DB_BASENAME = "9router-memory.sqlite";

function defaultUserDataDir() {
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "9router");
  }
  return path.join(os.homedir(), ".9router");
}

function readPkgName(pkgPath) {
  try {
    return JSON.parse(fs.readFileSync(pkgPath, "utf8")).name || "";
  } catch {
    return "";
  }
}

/**
 * Walk up from startDir looking for the 9router monorepo root.
 * Markers: package.json name 9router-app / 9router, or open-sse/ sibling.
 */
function findRepoRoot(startDir) {
  let dir = path.resolve(startDir || process.cwd());
  for (let i = 0; i < 12; i++) {
    const pkgPath = path.join(dir, "package.json");
    if (fs.existsSync(pkgPath)) {
      const name = readPkgName(pkgPath);
      if (name === "9router-app" || name === "9router" || fs.existsSync(path.join(dir, "open-sse"))) {
        return dir;
      }
    }
    // Built CLI lives under cli/app — still treat monorepo parent as root when present
    if (fs.existsSync(path.join(dir, "open-sse")) && fs.existsSync(path.join(dir, "src", "shared", "memory"))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * Known historical duplicate locations under a repo root (cwd-relative leftovers).
 */
function listLegacyDbCandidates(repoRoot) {
  if (!repoRoot) return [];
  return [
    path.join(repoRoot, "data", DB_BASENAME),
    path.join(repoRoot, "cli", "app", "data", DB_BASENAME),
    path.join(repoRoot, ".next", "standalone", "data", DB_BASENAME),
    path.join(repoRoot, ".next-cli-build", "standalone", "9router-fix-OpenCode", "data", DB_BASENAME),
    path.join(repoRoot, ".next-cli-build", "standalone", "data", DB_BASENAME),
  ];
}

/**
 * Cheap richness score: prefer more observations/memories when sqlite is
 * readable; fall back to size + mtime. Higher is better.
 */
function scoreDbFile(p) {
  if (!p || !fs.existsSync(p)) return null;
  try {
    const st = fs.statSync(p);
    if (st.size < 1024) return { path: p, size: st.size, mtimeMs: st.mtimeMs, rows: 0, score: 0 };

    let rows = 0;
    try {
      // better-sqlite3 may be optional; ignore if unavailable
      // eslint-disable-next-line import/no-extraneous-dependencies
      const Database = require("better-sqlite3");
      const db = new Database(p, { readonly: true, fileMustExist: true });
      try {
        rows += db.prepare("SELECT COUNT(*) AS c FROM observations").get().c || 0;
      } catch { /* table missing */ }
      try {
        rows += (db.prepare("SELECT COUNT(*) AS c FROM memories").get().c || 0) * 10;
      } catch { /* table missing */ }
      db.close();
    } catch {
      // no native reader — approximate by size only
      rows = Math.floor(st.size / 1024);
    }

    // rows dominate; size/mtime break near-ties
    const score = rows * 1_000_000 + st.size + Math.floor(st.mtimeMs / 1000);
    return { path: p, size: st.size, mtimeMs: st.mtimeMs, rows, score };
  } catch {
    return null;
  }
}

/**
 * Pick the "richest" existing DB among candidates.
 * Used once to seed/promote a canonical file without losing data.
 */
function pickRichestDb(candidates) {
  let best = null;
  for (const p of candidates) {
    const scored = scoreDbFile(p);
    if (!scored) continue;
    if (!best || scored.score > best.score) best = scored;
  }
  return best;
}

/**
 * If canonical path is missing or poorer than a legacy duplicate, copy the
 * richest legacy DB into the canonical location (one-shot heal).
 */
function healCanonicalFromLegacy(canonicalPath, repoRoot) {
  try {
    const candidates = [
      canonicalPath,
      ...listLegacyDbCandidates(repoRoot),
    ];
    const richest = pickRichestDb(candidates);
    if (!richest) return { healed: false };
    if (richest.path === canonicalPath) return { healed: false, richest: richest.path };

    const canon = scoreDbFile(canonicalPath);
    const shouldCopy =
      !canon ||
      canon.score < 1 ||
      richest.score > canon.score;

    if (!shouldCopy) return { healed: false, richest: richest.path };

    fs.mkdirSync(path.dirname(canonicalPath), { recursive: true });
    // Safety: backup existing canonical if non-empty before overwrite
    if (canon && canon.size > 2048) {
      const bak = `${canonicalPath}.bak-${Date.now()}`;
      try { fs.copyFileSync(canonicalPath, bak); } catch { /* ignore */ }
    }
    fs.copyFileSync(richest.path, canonicalPath);
    return { healed: true, from: richest.path, to: canonicalPath, rows: richest.rows };
  } catch (e) {
    console.warn("[resolveMemoryDbPath] heal failed:", e.message);
    return { healed: false, error: e.message };
  }
}

/**
 * Resolve the single absolute path for the memory SQLite file.
 * @param {string} [configDbPath] optional path from MemoryConfig / initialize()
 * @returns {string} absolute filesystem path
 */
function resolveMemoryDbPath(configDbPath) {
  const envPath = process.env.MEMORY_DB_PATH || process.env.MEMORY_STORAGE_DB_PATH;
  if (envPath && String(envPath).trim()) {
    return path.resolve(String(envPath).trim());
  }

  if (configDbPath && path.isAbsolute(configDbPath)) {
    return configDbPath;
  }

  // Resolve relative config against repo root (NOT process.cwd())
  const repoRoot =
    findRepoRoot(__dirname) ||
    findRepoRoot(process.cwd()) ||
    null;

  if (configDbPath && String(configDbPath).trim() && repoRoot) {
    // "./data/9router-memory.sqlite" → <repo>/data/9router-memory.sqlite
    const abs = path.resolve(repoRoot, configDbPath);
    healCanonicalFromLegacy(abs, repoRoot);
    return abs;
  }

  if (repoRoot) {
    const canonical = path.join(repoRoot, "data", DB_BASENAME);
    const heal = healCanonicalFromLegacy(canonical, repoRoot);
    if (heal.healed) {
      console.log(`[resolveMemoryDbPath] seeded canonical DB from ${heal.from}`);
    }
    return canonical;
  }

  // Outside monorepo (global install / packaged): use app data dir
  const dataDir = process.env.DATA_DIR && String(process.env.DATA_DIR).trim()
    ? process.env.DATA_DIR
    : defaultUserDataDir();
  return path.join(dataDir, DB_BASENAME);
}

module.exports = {
  resolveMemoryDbPath,
  findRepoRoot,
  listLegacyDbCandidates,
  DB_BASENAME,
};
