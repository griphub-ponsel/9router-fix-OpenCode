import { PROVIDERS } from "./providers.js";
import REGISTRY from "../providers/registry/index.js";
// PROVIDER_MODELS now built from providers/registry (transport + models co-located)
import { PROVIDER_MODELS } from "../providers/index.js";
import { modelQuotaFamily, modelStrip, modelTargetFormat, normalizeModelId } from "../providers/models/schema.js";
import { CODEX_REVIEW_SUFFIX } from "../providers/models/helpers.js";

export { PROVIDER_MODELS };


// Helper functions
export function getProviderModels(aliasOrId) {
  return PROVIDER_MODELS[aliasOrId] || [];
}

export function getDefaultModel(aliasOrId) {
  const models = PROVIDER_MODELS[aliasOrId];
  return models?.[0]?.id || null;
}

const DOT_VERSION_PROVIDERS = new Set(["kr", "kiro"]);

function findModel(models, modelId, aliasOrId) {
  if (!models) return undefined;
  const exact = models.find((model) => model.id === modelId);
  if (exact || !DOT_VERSION_PROVIDERS.has(aliasOrId)) return exact;
  const normalizedId = normalizeModelId(modelId);
  return models.find((model) => normalizeModelId(model.id) === normalizedId);
}

export function isValidModel(aliasOrId, modelId, passthroughProviders = new Set()) {
  if (passthroughProviders.has(aliasOrId)) return true;
  const models = PROVIDER_MODELS[aliasOrId];
  if (!models) return false;
  return Boolean(findModel(models, modelId, aliasOrId));
}

export function findModelName(aliasOrId, modelId) {
  const models = PROVIDER_MODELS[aliasOrId];
  if (!models) return modelId;
  const found = findModel(models, modelId, aliasOrId);
  return found?.name || modelId;
}

export function getModelTargetFormat(aliasOrId, modelId) {
  const models = PROVIDER_MODELS[aliasOrId];
  if (!models) return null;
  return modelTargetFormat(findModel(models, modelId, aliasOrId));
}

export function getModelType(aliasOrId, modelId) {
  const models = PROVIDER_MODELS[aliasOrId];
  if (!models) return null;
  const found = findModel(models, modelId, aliasOrId);
  return found?.kind || found?.type || null;
}

export function getModelUpstreamId(aliasOrId, modelId) {
  const models = PROVIDER_MODELS[aliasOrId];
  const found = findModel(models, modelId, aliasOrId);
  if (found?.upstreamModelId) return found.upstreamModelId;
  if (found?.id) return found.id;
  if (aliasOrId === "cx" && typeof modelId === "string" && modelId.endsWith(CODEX_REVIEW_SUFFIX)) {
    return modelId.slice(0, -CODEX_REVIEW_SUFFIX.length);
  }
  return modelId;
}

export function getModelQuotaFamily(aliasOrId, modelId) {
  const models = PROVIDER_MODELS[aliasOrId];
  return modelQuotaFamily(findModel(models, modelId, aliasOrId));
}

// OAuth short aliases — derived from registry `alias` (single source). everything else: alias = id.
// vertex/vertex-partner keep alias=id (kept via the `|| id` fallback in consumers).
export const OAUTH_ALIASES = Object.fromEntries(
  REGISTRY.filter(r => r.alias && r.alias !== r.id).map(r => [r.id, r.alias])
);

// Derived from PROVIDERS — no need to maintain manually
export const PROVIDER_ID_TO_ALIAS = Object.fromEntries(
  Object.keys(PROVIDERS).map(id => [id, OAUTH_ALIASES[id] || id])
);

export function getModelsByProviderId(providerId) {
  const alias = PROVIDER_ID_TO_ALIAS[providerId] || providerId;
  return PROVIDER_MODELS[alias] || [];
}

// Get strip list for a model entry (explicit opt-in only)
// Returns array of content types to strip, e.g. ["image", "audio"]
export function getModelStrip(alias, modelId) {
  return modelStrip(findModel(PROVIDER_MODELS[alias], modelId, alias));
}

// Model context/output limits (used by the Copilot config generator). Returns null
// when a model entry carries no explicit contextTokens metadata.
export function getModelLimits(aliasOrId, modelId) {
  const found = findModel(PROVIDER_MODELS[aliasOrId], modelId, aliasOrId);
  return found?.contextTokens ? {
    contextTokens: found.contextTokens,
    maxOutputTokens: found.maxOutputTokens || 16000,
  } : null;
}
