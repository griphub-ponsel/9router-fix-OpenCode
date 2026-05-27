const api = require("../api/client");
const { prompt } = require("./input");
const { clearScreen } = require("./display");

const PROVIDER_ALIAS_ORDER = [
  "cc", "ag", "cx", "if", "qw", "gc", "gh", "kr",
  "openrouter", "glm", "kimi", "minimax", "openai", "anthropic", "gemini"
];

const PROVIDER_ALIAS_NAMES = {
  cc: "Claude Code",
  ag: "Antigravity",
  cx: "OpenAI Codex",
  if: "iFlow AI",
  qw: "Qwen Code",
  gc: "Gemini CLI",
  gh: "GitHub Copilot",
  kr: "Kiro AI",
  openrouter: "OpenRouter",
  glm: "GLM Coding",
  kimi: "Kimi Coding",
  minimax: "Minimax Coding",
  openai: "OpenAI",
  anthropic: "Anthropic",
  gemini: "Gemini"
};

const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
};

async function getAvailableModelsGrouped() {
  const result = await api.getAvailableModels();
  if (!result.success) return { combos: [], groups: {} };

  const models = result.data?.data || [];
  const combos = [];
  const groups = {};
  const seen = new Set();

  models.forEach(m => {
    if (seen.has(m.id)) return;
    seen.add(m.id);
    if (m.owned_by === "combo") {
      combos.push(m.id);
    } else {
      const provider = m.owned_by;
      if (!groups[provider]) groups[provider] = [];
      groups[provider].push(m.id);
    }
  });

  return { combos, groups };
}

function stripAnsi(s) {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

function padEnd(str, len) {
  const visible = stripAnsi(str).length;
  return str + " ".repeat(Math.max(0, len - visible));
}

function truncate(str, maxLen) {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 1) + "\u2026";
}

function buildTableRows(allModels, filter) {
  const q = (filter || "").toLowerCase();
  return allModels
    .map((m, i) => ({ idx: i + 1, ...m }))
    .filter(m => !q || m.provider.toLowerCase().includes(q) || m.model.toLowerCase().includes(q));
}

function renderTable(rows, termWidth) {
  const colIdx = 4;
  const colProvider = 16;
  const colModel = Math.max(20, termWidth - colIdx - colProvider - 12);

  const header =
    C.bold + C.cyan +
    padEnd(" #", colIdx) + " \u2502 " +
    padEnd("Provider", colProvider) + " \u2502 " +
    padEnd("Model", colModel) +
    C.reset;
  const sep =
    C.dim +
    "\u2500".repeat(colIdx) + "\u2500\u253c\u2500" +
    "\u2500".repeat(colProvider) + "\u2500\u253c\u2500" +
    "\u2500".repeat(colModel) +
    C.reset;

  console.log(header);
  console.log(sep);

  let lastGroup = null;
  for (const row of rows) {
    if (row.group !== lastGroup) {
      if (lastGroup !== null) console.log(C.dim + "\u2500".repeat(colIdx + colProvider + colModel + 6) + C.reset);
      console.log(C.bold + C.yellow + ` ${row.group}` + C.reset);
      lastGroup = row.group;
    }
    const idxStr = C.dim + String(row.idx).padStart(colIdx - 1) + C.reset;
    const providerStr = C.cyan + truncate(row.provider, colProvider) + C.reset;
    const modelStr = truncate(row.model, colModel);
    console.log(` ${idxStr} \u2502 ${padEnd(providerStr, colProvider)} \u2502 ${modelStr}`);
  }
}

async function selectModelFromList(title, currentValue = "", options = {}) {
  const { excludeCombos = false } = options;
  const { combos: rawCombos, groups } = await getAvailableModelsGrouped();
  const combos = excludeCombos ? [] : rawCombos;

  const allModels = [];

  if (combos.length > 0) {
    combos.forEach(combo => {
      allModels.push({ provider: "Combo", model: combo, group: "Combos" });
    });
  }

  const sortedProviders = Object.keys(groups).sort((a, b) => {
    const idxA = PROVIDER_ALIAS_ORDER.indexOf(a);
    const idxB = PROVIDER_ALIAS_ORDER.indexOf(b);
    return (idxA === -1 ? 999 : idxA) - (idxB === -1 ? 999 : idxB);
  });

  sortedProviders.forEach(provider => {
    const providerName = PROVIDER_ALIAS_NAMES[provider] || provider;
    groups[provider].forEach(model => {
      allModels.push({ provider: providerName, model, group: providerName, alias: provider });
    });
  });

  if (allModels.length === 0) return null;

  let filter = "";

  while (true) {
    const termWidth = (process.stdout.columns || 80);
    const rows = buildTableRows(allModels, filter);

    clearScreen();
    console.log(`\n${C.bold}${C.cyan}\u{1F3AF} ${title}${C.reset}`);
    console.log(C.dim + "\u2500".repeat(Math.min(termWidth, 60)) + C.reset);
    if (currentValue) console.log(`${C.dim}Current: ${C.reset}${C.green}${currentValue}${C.reset}`);
    if (filter) console.log(`${C.dim}Filter:  ${C.reset}${C.yellow}"${filter}"${C.reset}`);
    console.log();

    if (rows.length === 0) {
      console.log(C.yellow + "  No models match filter." + C.reset);
    } else {
      renderTable(rows, termWidth);
    }

    console.log();
    console.log(C.dim + "  Enter number to select | x<number> to disable | s <text> to search | 0 to cancel" + C.reset);
    console.log();

    const input = (await prompt(filter ? `Search (${filter}): ` : "Select: ")).trim();

    if (!input) continue;

    if (input === "0" || input.toLowerCase() === "cancel") return null;

    if (input.toLowerCase().startsWith("s ")) {
      filter = input.slice(2).trim();
      continue;
    }

    if (input.toLowerCase() === "s") {
      filter = "";
      continue;
    }

    if (/^x\d+$/i.test(input)) {
      const targetIdx = parseInt(input.slice(1), 10);
      const target = rows.find(r => r.idx === targetIdx);
      if (!target) {
        console.log(C.red + `  Invalid number: ${targetIdx}` + C.reset);
        await new Promise(r => setTimeout(r, 800));
        continue;
      }
      if (target.group === "Combos") {
        console.log(C.yellow + "  Cannot disable combo models." + C.reset);
        await new Promise(r => setTimeout(r, 800));
        continue;
      }
      const providerAlias = target.alias || target.provider;
      const modelId = target.model.replace(/^[^/]+\//, "");
      const res = await api.disableModel(providerAlias, [modelId]);
      if (res.success) {
        console.log(C.green + `  Disabled: ${target.model}` + C.reset);
        const idx = allModels.indexOf(allModels.find(m => m.model === target.model && m.provider === target.provider));
        if (idx !== -1) allModels.splice(idx, 1);
        await new Promise(r => setTimeout(r, 600));
      } else {
        console.log(C.red + `  Failed: ${res.error}` + C.reset);
        await new Promise(r => setTimeout(r, 1000));
      }
      continue;
    }

    const num = parseInt(input, 10);
    if (isNaN(num) || num < 1) {
      console.log(C.red + "  Invalid input." + C.reset);
      await new Promise(r => setTimeout(r, 600));
      continue;
    }

    const selected = rows.find(r => r.idx === num);
    if (!selected) {
      console.log(C.red + `  Invalid number: ${num}` + C.reset);
      await new Promise(r => setTimeout(r, 600));
      continue;
    }

    return selected.model;
  }
}

module.exports = {
  selectModelFromList,
  getAvailableModelsGrouped,
  PROVIDER_ALIAS_ORDER,
  PROVIDER_ALIAS_NAMES
};
