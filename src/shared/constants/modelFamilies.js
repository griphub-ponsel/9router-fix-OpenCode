// Model "families" — the top-level AI brand a model belongs to (GPT, Claude, ...),
// independent of which provider serves it. Each family maps to an AI logo in
// /public/providers and a matcher on the model id. Order matters: first match wins,
// so keep specific patterns above generic ones.
//
// NOTE: `logo` here is the AI brand logo (openai, claude, gemini, ...), NOT the
// serving provider's logo (blackbox, kiro, copilot, ...). This is intentional:
// auto-combos group the same model identity across providers, so the AI brand is
// the meaningful icon.
export const PROVIDER_FAMILIES = [
  { key: "muse", label: "Muse", logo: "meta.svg", color: "#0866ff", match: (id) => /muse[-_ ]?spark/i.test(id) },
  { key: "gpt", label: "GPT", logo: "openai", color: "#10a37f", match: (id) => /gpt|chatgpt|codex|(^|[^a-z])o[0-9]/i.test(id) },
  { key: "claude", label: "Claude", logo: "claude", color: "#d97757", match: (id) => /claude/i.test(id) },
  { key: "gemini", label: "Gemini", logo: "gemini", color: "#4285f4", match: (id) => /gemini/i.test(id) },
  { key: "minimax", label: "MiniMax", logo: "minimax", color: "#ff4d4f", match: (id) => /minimax/i.test(id) },
  { key: "kimi", label: "Kimi", logo: "kimi", color: "#6d28d9", match: (id) => /kimi/i.test(id) },
  { key: "glm", label: "GLM", logo: "glm", color: "#3b82f6", match: (id) => /glm/i.test(id) },
  { key: "mimo", label: "MiMo", logo: "mimo-free", color: "#f97316", match: (id) => /mimo/i.test(id) },
  { key: "qwen", label: "Qwen", logo: "qwen", color: "#a855f7", match: (id) => /qwen/i.test(id) },
  { key: "grok", label: "Grok", logo: "xai", color: "#111827", match: (id) => /grok/i.test(id) },
  { key: "deepseek", label: "DeepSeek", logo: "deepseek", color: "#2563eb", match: (id) => /deepseek/i.test(id) },
];

const FAMILY_BY_KEY = Object.fromEntries(PROVIDER_FAMILIES.map((f) => [f.key, f]));

// Resolve the family key for a bare model id (e.g. "gpt-5.5" → "gpt").
export function detectFamily(modelId) {
  const id = String(modelId || "");
  for (const f of PROVIDER_FAMILIES) {
    if (f.match(id)) return f.key;
  }
  return "other";
}

// Full family descriptor (with logo/color/label) for a model id. Falls back to a
// neutral "Other" family when nothing matches.
export function getFamily(modelId) {
  return FAMILY_BY_KEY[detectFamily(modelId)] || { key: "other", label: "Other", logo: null, color: "#6b7280" };
}

// Normalize a model id to its cross-provider identity. Providers publish the same
// model under wildly different ids (cline: "anthropic/claude-opus-4.8", antigravity:
// "claude-sonnet-4-6", commandcode: "moonshotai/Kimi-K2.6", anthropic:
// "claude-3-5-sonnet-20241022"), so we canonicalize before comparing:
//   1. keep only the last "/" segment (drops vendor/router prefixes)
//   2. lowercase + unify "_"/spaces to "-"
//   3. strip trailing date snapshots (-20241022, -251104, -2026-01-23)
//   4. version separators: digit-dash-digit → digit-dot-digit (4-6 → 4.6)
//   5. drop redundant trailing ".0" in versions (glm-5.0 → glm-5)
//   6. drop cosmetic "-preview" suffix
export function normalizeModelIdentity(rawId) {
  let id = String(rawId || "");
  const slash = id.lastIndexOf("/");
  if (slash !== -1) id = id.slice(slash + 1);
  id = id.toLowerCase().replace(/[_\s]+/g, "-");
  id = id.replace(/-\d{4}-\d{2}-\d{2}$/, "").replace(/-\d{4,8}$/, "");
  while (/(\d)-(\d)/.test(id)) id = id.replace(/(\d)-(\d)/, "$1.$2");
  id = id.replace(/(\d)\.0(?=-|$)/g, "$1");
  id = id.replace(/-preview$/, "");
  return id;
}

// Normalize a display name for fuzzy identity matching: drop parenthetical
// qualifiers ("(ClinePass)", "(Thinking)"), keep alphanumerics only.
// "Kimi K2.7 Code (ClinePass)" and "Kimi-K2.7-Code" both → "kimik27code".
export function normalizeModelName(rawName) {
  return String(rawName || "")
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/[^a-z0-9]+/g, "");
}

// Group models that share the same identity across 2+ providers. Two models match
// when their normalized ids match, or their normalized display names match. Name
// matching is skipped for "poisoned" names — when one provider has several models
// collapsing to the same name key (e.g. antigravity's "(High)/(Medium)/(Low)"
// variants), the name is ambiguous and only id matching applies.
// `models`: [{ provider, model, fullModel, name }] — returns
// [{ id, name, members: [fullModel] }] sorted by member count.
export function buildOverlapGroups(models) {
  const entries = [];
  for (const m of models || []) {
    if (!m?.model || !m?.fullModel || !m?.provider) continue;
    const raw = String(m.model);
    entries.push({
      provider: m.provider,
      fullModel: m.fullModel,
      bareId: raw.slice(raw.lastIndexOf("/") + 1),
      idKey: normalizeModelIdentity(raw),
      nameKey: normalizeModelName(m.name),
      name: String(m.name || raw),
    });
  }

  // Union-find over entries
  const parent = entries.map((_, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[rb] = ra; };

  const byIdKey = new Map();
  entries.forEach((e, i) => {
    if (!e.idKey) return;
    if (byIdKey.has(e.idKey)) union(byIdKey.get(e.idKey), i);
    else byIdKey.set(e.idKey, i);
  });

  // Poisoned name keys: same provider maps 2+ distinct models to one name key.
  const nameProviderCount = new Map();
  for (const e of entries) {
    if (!e.nameKey) continue;
    const k = `${e.nameKey}\u0000${e.provider}`;
    nameProviderCount.set(k, (nameProviderCount.get(k) || 0) + 1);
  }
  const poisoned = new Set();
  for (const [k, count] of nameProviderCount) {
    if (count > 1) poisoned.add(k.split("\u0000")[0]);
  }

  const byNameKey = new Map();
  entries.forEach((e, i) => {
    if (!e.nameKey || poisoned.has(e.nameKey)) return;
    if (byNameKey.has(e.nameKey)) union(byNameKey.get(e.nameKey), i);
    else byNameKey.set(e.nameKey, i);
  });

  // Collect groups, dedupe by provider (one member per provider), keep 2+ providers.
  const groupsByRoot = new Map();
  entries.forEach((e, i) => {
    const r = find(i);
    if (!groupsByRoot.has(r)) groupsByRoot.set(r, []);
    groupsByRoot.get(r).push(e);
  });

  const groups = [];
  for (const list of groupsByRoot.values()) {
    const seenProviders = new Set();
    const members = [];
    let rep = null;
    for (const e of list) {
      if (seenProviders.has(e.provider)) continue;
      seenProviders.add(e.provider);
      members.push(e.fullModel);
      if (!rep || e.bareId.length < rep.bareId.length) rep = e;
    }
    if (seenProviders.size < 2) continue;
    members.sort();
    groups.push({
      id: rep.idKey || rep.bareId,
      name: rep.name.replace(/\s*\(.*?\)\s*$/, ""),
      members,
    });
  }
  groups.sort((a, b) => b.members.length - a.members.length || a.id.localeCompare(b.id));
  return groups;
}

// A combo is "auto-generated" when it groups the SAME model identity across 2+
// providers — i.e. every member normalizes to the same identity (e.g.
// kr/claude-sonnet-4-6 + ad/claude-sonnet-4-6, or cx/gpt-5.5 + gh/gpt-5.5).
// Uses normalization, so it also classifies combos created before this feature.
export function isAutoCombo(combo) {
  const models = combo?.models;
  if (!Array.isArray(models) || models.length < 2) return false;
  if (!models.every((m) => typeof m === "string" && m.includes("/"))) return false;
  const ids = models.map((m) => normalizeModelIdentity(m));
  return ids.every((id) => id && id === ids[0]);
}

// The shared (normalized) model id of an auto-combo — used to pick the AI family logo.
export function autoComboModelId(combo) {
  return normalizeModelIdentity(combo?.models?.[0]);
}
