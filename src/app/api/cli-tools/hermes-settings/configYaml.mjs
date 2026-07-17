export const PROVIDER_NAME = "9router";
export const API_KEY_ENV = "OPENAI_API_KEY";

const MODEL_BLOCK_RE = /^model:[ \t]*\r?\n((?:[ \t]+.*\r?\n?|[ \t]*\r?\n)*)/m;
const PROVIDERS_BLOCK_RE = /^providers:[ \t]*\r?\n((?:[ \t]+.*\r?\n?|[ \t]*\r?\n)*)/m;
const ROUTER_PROVIDER_RE = /^  9router:[ \t]*\r?\n((?:[ \t]{4}.*\r?\n?|[ \t]*\r?\n)*)/m;

const buildModelBlock = (model, baseUrl) =>
  `model:\n  default: ${JSON.stringify(model)}\n  provider: "${PROVIDER_NAME}"\n  base_url: ${JSON.stringify(baseUrl)}\n`;

const buildRouterProviderBlock = (models, modelNames, modelContextLengths, defaultModel, baseUrl) => {
  const modelEntries = models.map((model) => {
    const displayName = typeof modelNames?.[model] === "string" ? modelNames[model].trim() : "";
    const pickerId = displayName || model;
    const contextLength = Number(modelContextLengths?.[model]);
    const contextLine = Number.isSafeInteger(contextLength) && contextLength > 0
      ? `\n        context_length: ${contextLength}`
      : "";
    if (pickerId === model) {
      return contextLine
        ? `      ${JSON.stringify(model)}:${contextLine}`
        : `      ${JSON.stringify(model)}: {}`;
    }
    return `      ${JSON.stringify(pickerId)}:\n        target_model: ${JSON.stringify(model)}\n        display_name: ${JSON.stringify(displayName)}${contextLine}`;
  }).join("\n");
  const defaultPickerId = (typeof modelNames?.[defaultModel] === "string" && modelNames[defaultModel].trim()) || defaultModel;
  return `  ${PROVIDER_NAME}:\n    name: "9Router"\n    base_url: ${JSON.stringify(baseUrl)}\n    key_env: "${API_KEY_ENV}"\n    transport: "openai_chat"\n    discover_models: false\n    default_model: ${JSON.stringify(defaultPickerId)}\n    models:\n${modelEntries}\n`;
};

const parseModelBlock = (yaml) => {
  const match = yaml.match(MODEL_BLOCK_RE);
  if (!match) return null;
  const body = match[1] || "";
  const get = (key) => {
    const valueMatch = body.match(new RegExp(`^[ \\t]+${key}:[ \\t]*["']?([^"'\\r\\n]+)["']?`, "m"));
    return valueMatch ? valueMatch[1].trim() : null;
  };
  const contextLength = Number(get("context_length"));
  return {
    default: get("default"),
    provider: get("provider"),
    base_url: get("base_url"),
    ...(Number.isSafeInteger(contextLength) && contextLength > 0 ? { context_length: contextLength } : {}),
  };
};

const parseRouterModels = (yaml) => {
  const providersMatch = yaml.match(PROVIDERS_BLOCK_RE);
  if (!providersMatch) return { models: [], modelNames: {}, modelContextLengths: {} };
  const routerMatch = providersMatch[1].match(ROUTER_PROVIDER_RE);
  if (!routerMatch) return { models: [], modelNames: {}, modelContextLengths: {} };

  const body = routerMatch[1] || "";
  const modelsMatch = body.match(/^    models:[ \t]*\r?\n((?:[ \t]{6}.*\r?\n?|[ \t]*\r?\n)*)/m);
  const models = [];
  const modelNames = {};
  const modelContextLengths = {};
  const pickerTargets = {};
  let currentModel = "";
  let currentPickerId = "";
  for (const line of (modelsMatch?.[1] || "").split(/\r?\n/)) {
    const targetMatch = line.match(/^        target_model:[ \t]*("(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|.*)$/);
    if (currentPickerId && targetMatch) {
      const rawTarget = targetMatch[1].trim();
      let targetModel = "";
      if (rawTarget.startsWith('"')) {
        try { targetModel = JSON.parse(rawTarget); } catch { /* Ignore malformed metadata */ }
      } else if (rawTarget.startsWith("'")) {
        targetModel = rawTarget.slice(1, -1).replace(/''/g, "'");
      } else {
        targetModel = rawTarget;
      }
      if (targetModel) {
        pickerTargets[currentPickerId] = targetModel;
        models[models.length - 1] = targetModel;
        currentModel = targetModel;
      }
      continue;
    }

    const displayMatch = line.match(/^        display_name:[ \t]*("(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|.*)$/);
    if (currentModel && displayMatch) {
      const rawDisplayName = displayMatch[1].trim();
      if (rawDisplayName.startsWith('"')) {
        try { modelNames[currentModel] = JSON.parse(rawDisplayName); } catch { /* Ignore malformed metadata */ }
      } else if (rawDisplayName.startsWith("'")) {
        modelNames[currentModel] = rawDisplayName.slice(1, -1).replace(/''/g, "'");
      } else if (rawDisplayName) {
        modelNames[currentModel] = rawDisplayName;
      }
      continue;
    }

    const contextMatch = line.match(/^        context_length:[ \t]*(\d+)[ \t]*$/);
    if (currentModel && contextMatch) {
      const contextLength = Number(contextMatch[1]);
      if (Number.isSafeInteger(contextLength) && contextLength > 0) {
        modelContextLengths[currentModel] = contextLength;
      }
      continue;
    }

    const match = line.match(/^ {6}(?=\S)("(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^:#][^:]*):/);
    if (match) {
      const raw = match[1].trim();
      if (raw.startsWith('"')) {
        try { currentModel = JSON.parse(raw); } catch { currentModel = ""; }
      } else if (raw.startsWith("'")) {
        currentModel = raw.slice(1, -1).replace(/''/g, "'");
      } else {
        currentModel = raw;
      }
      currentPickerId = currentModel;
      if (currentModel) models.push(currentModel);
    }
  }
  return { models, modelNames, modelContextLengths, pickerTargets };
};

const upsertModelBlock = (yaml, newBlock) => {
  if (MODEL_BLOCK_RE.test(yaml)) return yaml.replace(MODEL_BLOCK_RE, newBlock);
  return yaml.length > 0 ? `${newBlock}\n${yaml}` : newBlock;
};

const upsertRouterProviderBlock = (yaml, newBlock) => {
  const providersMatch = yaml.match(PROVIDERS_BLOCK_RE);
  if (!providersMatch) {
    const separator = yaml.length === 0 ? "" : (yaml.endsWith("\n") ? "\n" : "\n\n");
    return `${yaml}${separator}providers:\n${newBlock}`;
  }

  const providersBody = providersMatch[1] || "";
  const nextBody = ROUTER_PROVIDER_RE.test(providersBody)
    ? providersBody.replace(ROUTER_PROVIDER_RE, newBlock)
    : `${providersBody}${providersBody.endsWith("\n") ? "" : "\n"}${newBlock}`;
  return yaml.replace(PROVIDERS_BLOCK_RE, `providers:\n${nextBody}`);
};

export const readHermesConfig = (yaml) => {
  const model = parseModelBlock(yaml);
  const { models, modelNames, modelContextLengths, pickerTargets } = parseRouterModels(yaml);
  const defaultModel = pickerTargets[model?.default] || model?.default;
  return {
    model: model ? { ...model, default: defaultModel } : null,
    models: models.length > 0 ? models : (model?.default ? [model.default] : []),
    modelNames,
    modelContextLengths,
  };
};

export const writeHermesConfig = (yaml, { models, modelNames = {}, modelContextLengths = {}, defaultModel, baseUrl }) => {
  const defaultPickerId = (typeof modelNames?.[defaultModel] === "string" && modelNames[defaultModel].trim()) || defaultModel;
  const withProvider = upsertRouterProviderBlock(
    yaml,
    buildRouterProviderBlock(models, modelNames, modelContextLengths, defaultModel, baseUrl)
  );
  return upsertModelBlock(withProvider, buildModelBlock(defaultPickerId, baseUrl));
};

export const removeHermesConfig = (yaml) => {
  const withoutModel = yaml.replace(MODEL_BLOCK_RE, "").replace(/^\n+/, "");
  const providersMatch = withoutModel.match(PROVIDERS_BLOCK_RE);
  if (!providersMatch) return withoutModel;
  const nextBody = (providersMatch[1] || "").replace(ROUTER_PROVIDER_RE, "");
  return withoutModel
    .replace(PROVIDERS_BLOCK_RE, nextBody.trim() ? `providers:\n${nextBody}` : "")
    .replace(/^\n+/, "");
};