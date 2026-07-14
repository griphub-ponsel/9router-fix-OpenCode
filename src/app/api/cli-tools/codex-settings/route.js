"use server";

import { NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { parseTOML, stringifyTOML } from "confbox";
import { findModelName } from "open-sse/config/providerModels.js";
import { getSettings, updateSettings } from "@/lib/localDb";

const execAsync = promisify(exec);

const getCodexDir = () => path.join(os.homedir(), ".codex");
const getCodexConfigPath = () => path.join(getCodexDir(), "config.toml");
const getCodexAuthPath = () => path.join(getCodexDir(), "auth.json");
const getCodexCatalogPath = () => path.join(getCodexDir(), "9router-models.json");
const getCodexModelsCachePath = () => path.join(getCodexDir(), "models_cache.json");

const DEFAULT_REASONING_EFFORTS = ["low", "medium", "high"];
const VALID_REASONING_EFFORTS = new Set(["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"]);
// Codex model-catalog schema currently rejects `max`/`ultra` even though
// 9Router clients can expose those efforts. A single unsupported enum value
// makes Codex discard the entire custom catalog and show only "Custom".
const CODEX_CATALOG_REASONING_EFFORTS = new Set(["none", "minimal", "low", "medium", "high", "xhigh"]);

const normalizeReasoningEffort = (value) => VALID_REASONING_EFFORTS.has(value) ? value : "medium";

const detectCodexClientVersion = async () => {
  const candidates = [];
  if (os.platform() === "win32") {
    const desktopBinDir = path.join(process.env.LOCALAPPDATA || "", "OpenAI", "Codex", "bin");
    try {
      const dirs = await fs.readdir(desktopBinDir, { withFileTypes: true });
      for (const dir of dirs) {
        if (dir.isDirectory()) candidates.push(path.join(desktopBinDir, dir.name, "codex.exe"));
      }
    } catch { /* Codex Desktop runtime cache not installed */ }
  }
  candidates.push("codex");

  for (const executable of candidates) {
    try {
      const isWindows = os.platform() === "win32";
      const command = isWindows
        ? `& '${String(executable).replaceAll("'", "''")}' --version`
        : `"${String(executable).replaceAll('"', '\\"')}" --version`;
      const { stdout } = await execAsync(command, {
        ...(isWindows ? { shell: "powershell.exe" } : {}),
        windowsHide: true,
      });
      const match = String(stdout).match(/codex-cli\s+(\d+\.\d+\.\d+)/i);
      if (match) return match[1];
    } catch { /* Try the next installed Codex binary */ }
  }
  return null;
};

const createCatalogModel = ({ slug, displayName, contextWindow, defaultReasoningEffort, reasoningEfforts, imageInput, priority }) => ({
  slug,
  display_name: displayName,
  description: `9Router model: ${displayName}`,
  default_reasoning_level: defaultReasoningEffort,
  supported_reasoning_levels: reasoningEfforts.map((effort) => ({ effort, description: `${effort[0].toUpperCase()}${effort.slice(1)} reasoning` })),
  shell_type: "shell_command",
  visibility: "list",
  supported_in_api: true,
  priority,
  availability_nux: null,
  upgrade: null,
  base_instructions: "You are a coding agent. Use the available tools to complete the user's task accurately.",
  model_messages: null,
  support_verbosity: false,
  default_verbosity: null,
  apply_patch_tool_type: null,
  truncation_policy: { mode: "tokens", limit: 10000 },
  supports_parallel_tool_calls: true,
  supports_reasoning_summaries: true,
  supports_image_detail_original: false,
  input_modalities: imageInput ? ["text", "image"] : ["text"],
  context_window: contextWindow,
  max_context_window: contextWindow,
  auto_compact_token_limit: null,
  experimental_supported_tools: [],
});

const resolveModelDisplayName = (fullId) => {
  if (typeof fullId !== "string" || !fullId.includes("/")) return fullId;
  const slash = fullId.indexOf("/");
  const name = findModelName(fullId.slice(0, slash), fullId.slice(slash + 1));
  return name && name !== fullId.slice(slash + 1) ? name : fullId;
};

// Flatten confbox-parsed TOML into a writable object, preserving nested tables
const parsedToWritable = (obj) => obj ?? {};

// Set a nested key from a flat dotted path, creating intermediate objects as needed
const setNestedSection = (obj, dottedKey, value) => {
  const keys = dottedKey.split(".");
  let cur = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (cur[keys[i]] == null || typeof cur[keys[i]] !== "object") {
      cur[keys[i]] = {};
    }
    cur = cur[keys[i]];
  }
  cur[keys[keys.length - 1]] = value;
};

// Delete a nested key from a flat dotted path
const deleteNestedSection = (obj, dottedKey) => {
  const keys = dottedKey.split(".");
  let cur = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    cur = cur?.[keys[i]];
    if (cur == null) return;
  }
  delete cur[keys[keys.length - 1]];
};

// Check if codex CLI is installed (via which/where or config file exists)
const checkCodexInstalled = async () => {
  try {
    const isWindows = os.platform() === "win32";
    const command = isWindows ? "where codex" : "which codex";
    const env = isWindows
      ? { ...process.env, PATH: `${process.env.APPDATA}\\npm;${process.env.PATH}` }
      : process.env;
    await execAsync(command, { windowsHide: true, env });
    return true;
  } catch {
    try {
      await fs.access(getCodexConfigPath());
      return true;
    } catch {
      return false;
    }
  }
};

// Read current config.toml
const readConfig = async () => {
  try {
    const configPath = getCodexConfigPath();
    const content = await fs.readFile(configPath, "utf-8");
    return content;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
};

// Check if config has 9Router settings
const has9RouterConfig = (config) => {
  if (!config) return false;
  return config.includes("model_provider = \"9router\"") || config.includes("[model_providers.9router]");
};

// GET - Check codex CLI and read current settings
export async function GET() {
  try {
    const isInstalled = await checkCodexInstalled();
    
    if (!isInstalled) {
      return NextResponse.json({
        installed: false,
        config: null,
        message: "Codex CLI is not installed",
      });
    }

    const config = await readConfig();
    const parsed = config ? parsedToWritable(parseTOML(config)) : {};
    const settings = await getSettings().catch(() => ({}));
    const configuredModels = Array.isArray(settings?.codexCliModels)
      ? settings.codexCliModels.filter((model) => typeof model === "string" && model.trim())
      : [];
    const activeModel = parsed.model_provider === "9router" ? parsed.model || "" : "";
    const models = [...new Set([activeModel, ...configuredModels].filter(Boolean))];
    const storedNames = settings?.codexCliModelNames && typeof settings.codexCliModelNames === "object"
      ? settings.codexCliModelNames
      : {};
    const modelNames = Object.fromEntries(models.map((model) => [
      model,
      typeof storedNames[model] === "string" && storedNames[model].trim()
        ? storedNames[model]
        : resolveModelDisplayName(model),
    ]));
    const storedContextSizes = settings?.codexCliModelContextSizes && typeof settings.codexCliModelContextSizes === "object" ? settings.codexCliModelContextSizes : {};
    const modelContextSizes = Object.fromEntries(models.map((model) => [model, Number(storedContextSizes[model])]).filter(([, tokens]) => tokens > 0));
    const storedReasoningEfforts = settings?.codexCliModelReasoningEfforts && typeof settings.codexCliModelReasoningEfforts === "object" ? settings.codexCliModelReasoningEfforts : {};
    const modelReasoningEfforts = Object.fromEntries(models.map((model) => [model, normalizeReasoningEffort(storedReasoningEfforts[model])]));
    const visionFallbackModels = Array.isArray(settings?.visionFallbackModels) ? settings.visionFallbackModels : [];

    return NextResponse.json({
      installed: true,
      config,
      has9Router: has9RouterConfig(config),
      configPath: getCodexConfigPath(),
      codex: { models, modelNames, modelContextSizes, modelReasoningEfforts, activeModel },
      visionFallbackModels,
    });
  } catch (error) {
    console.log("Error checking codex settings:", error);
    return NextResponse.json({ error: "Failed to check codex settings" }, { status: 500 });
  }
}

// POST - Update 9Router settings (merge with existing config)
export async function POST(request) {
  try {
    const { baseUrl, apiKey, model, models, modelNames = {}, modelContextSizes = {}, modelReasoningEfforts = {}, modelReasoningOptions = {}, activeModel, subagentModel, visionFallbackModels } = await request.json();
    const modelsArray = [...new Set(
      (Array.isArray(models) ? models : typeof model === "string" ? [model] : [])
        .filter((entry) => typeof entry === "string" && entry.trim())
        .map((entry) => entry.trim())
    )];
    const selectedActiveModel = modelsArray.includes(activeModel) ? activeModel : modelsArray[0];
    
    if (!baseUrl || !apiKey || modelsArray.length === 0) {
      return NextResponse.json({ error: "baseUrl, apiKey and at least one model are required" }, { status: 400 });
    }

    const codexDir = getCodexDir();
    const configPath = getCodexConfigPath();

    // Ensure directory exists
    await fs.mkdir(codexDir, { recursive: true });

    // Read and parse existing config
    let parsed = {};
    try {
      const existingConfig = await fs.readFile(configPath, "utf-8");
      parsed = parsedToWritable(parseTOML(existingConfig));
    } catch { /* No existing config */ }

    // Update only 9Router related fields (api_key goes to auth.json, not config.toml)
    parsed.model = selectedActiveModel;
    parsed.model_provider = "9router";
    parsed.model_catalog_json = getCodexCatalogPath();

    // Update or create 9router provider section (no api_key - Codex reads from auth.json)
    // Ensure /v1 suffix is added only once
    const normalizedBaseUrl = baseUrl.endsWith("/v1") ? baseUrl : `${baseUrl}/v1`;
    setNestedSection(parsed, "model_providers.9router", {
      name: "9Router",
      base_url: normalizedBaseUrl,
      wire_api: "responses",
    });

    // Add subagent configuration
    const effectiveSubagentModel = subagentModel || selectedActiveModel;
    setNestedSection(parsed, "agents.subagent", {
      description: "General-purpose subagent routed through 9Router.",
      model: effectiveSubagentModel,
    });

    const normalizedModelNames = Object.fromEntries(modelsArray.map((entry) => [
      entry,
      typeof modelNames?.[entry] === "string" && modelNames[entry].trim()
        ? modelNames[entry].trim()
        : resolveModelDisplayName(entry),
    ]));
    const normalizedContextSizes = Object.fromEntries(modelsArray.map((entry) => [entry, Number(modelContextSizes?.[entry])]).filter(([, tokens]) => tokens > 0));
    const normalizedReasoningEfforts = Object.fromEntries(modelsArray.map((entry) => [entry, normalizeReasoningEffort(modelReasoningEfforts?.[entry])]));
    const normalizedReasoningOptions = Object.fromEntries(modelsArray.map((entry) => {
      const options = Array.isArray(modelReasoningOptions?.[entry])
        ? [...new Set(modelReasoningOptions[entry].filter((effort) => CODEX_CATALOG_REASONING_EFFORTS.has(effort)))]
        : [];
      const requestedDefault = normalizedReasoningEfforts[entry];
      const defaultEffort = CODEX_CATALOG_REASONING_EFFORTS.has(requestedDefault)
        ? requestedDefault
        : "xhigh";
      normalizedReasoningEfforts[entry] = defaultEffort;
      const catalogOptions = options.length ? options : [...DEFAULT_REASONING_EFFORTS];
      return [entry, catalogOptions.includes(defaultEffort) ? catalogOptions : [...catalogOptions, defaultEffort]];
    }));
    const cleanedVisionFallbackModels = Array.isArray(visionFallbackModels)
      ? [...new Set(visionFallbackModels.filter((entry) => typeof entry === "string" && entry.trim()).map((entry) => entry.trim()))]
      : [];
    const catalog = {
      models: modelsArray.map((entry, index) => createCatalogModel({
        slug: entry,
        displayName: normalizedModelNames[entry],
        contextWindow: normalizedContextSizes[entry] || 256000,
        defaultReasoningEffort: normalizedReasoningEfforts[entry],
        reasoningEfforts: normalizedReasoningOptions[entry],
        imageInput: cleanedVisionFallbackModels.length > 0,
        priority: entry === selectedActiveModel ? 0 : index + 1,
      })),
    };
    parsed.model_reasoning_effort = normalizedReasoningEfforts[selectedActiveModel];

    await fs.writeFile(getCodexCatalogPath(), JSON.stringify(catalog, null, 2));

    // Codex Desktop creates a per-thread config lock that intentionally clears
    // model_catalog_json. Its model manager then falls back to models_cache.json.
    // Seed that cache with the same catalog and Desktop runtime version so
    // locked/new threads still resolve display names instead of "Custom".
    const codexClientVersion = await detectCodexClientVersion();
    if (codexClientVersion) {
      await fs.writeFile(getCodexModelsCachePath(), JSON.stringify({
        // Codex gives this cache a five-minute TTL. 9Router's catalog is
        // regenerated explicitly by Apply Settings, so keep it authoritative
        // between launches instead of reverting locked threads to "Custom".
        fetched_at: "9999-12-31T23:59:59Z",
        etag: null,
        client_version: codexClientVersion,
        models: catalog.models,
      }, null, 2));
    }

    // Write merged config
    const configContent = stringifyTOML(parsed);
    await fs.writeFile(configPath, configContent);

    // Update auth.json with OPENAI_API_KEY (Codex reads this first)
    const authPath = getCodexAuthPath();
    let authData = {};
    try {
      const existingAuth = await fs.readFile(authPath, "utf-8");
      authData = JSON.parse(existingAuth);
    } catch { /* No existing auth */ }
    
    // Force apikey mode (keep existing tokens untouched for ChatGPT login reuse)
    authData.OPENAI_API_KEY = apiKey;
    authData.auth_mode = "apikey";
    await fs.writeFile(authPath, JSON.stringify(authData, null, 2));

    await updateSettings({
      codexCliModels: modelsArray,
      codexCliModelNames: normalizedModelNames,
      codexCliModelContextSizes: normalizedContextSizes,
      codexCliModelReasoningEfforts: normalizedReasoningEfforts,
      visionFallbackModels: cleanedVisionFallbackModels,
    });

    return NextResponse.json({
      success: true,
      message: "Codex settings applied. Restart Codex to reload the model catalog.",
      configPath,
      catalogPath: getCodexCatalogPath(),
      modelsCachePath: getCodexModelsCachePath(),
      codexClientVersion,
      modelCount: modelsArray.length,
      restartRequired: true,
    });
  } catch (error) {
    console.log("Error updating codex settings:", error);
    return NextResponse.json({ error: "Failed to update codex settings" }, { status: 500 });
  }
}

// DELETE - Remove 9Router settings only (keep other settings)
export async function DELETE() {
  try {
    const configPath = getCodexConfigPath();

    // Read and parse existing config
    let parsed = {};
    try {
      const existingConfig = await fs.readFile(configPath, "utf-8");
      parsed = parsedToWritable(parseTOML(existingConfig));
    } catch (error) {
      if (error.code === "ENOENT") {
        return NextResponse.json({
          success: true,
          message: "No config file to reset",
        });
      }
      throw error;
    }

    // Remove 9Router related root fields only if they point to 9router
    if (parsed.model_provider === "9router") {
      delete parsed.model;
      delete parsed.model_provider;
      delete parsed.model_reasoning_effort;
    }
    if (parsed.model_catalog_json === getCodexCatalogPath()) delete parsed.model_catalog_json;

    // Remove 9router provider section
    deleteNestedSection(parsed, "model_providers.9router");

    // Remove subagent configuration
    deleteNestedSection(parsed, "agents.subagent");

    // Write updated config
    const configContent = stringifyTOML(parsed);
    await fs.writeFile(configPath, configContent);

    // Remove OPENAI_API_KEY from auth.json
    const authPath = getCodexAuthPath();
    try {
      const existingAuth = await fs.readFile(authPath, "utf-8");
      const authData = JSON.parse(existingAuth);
      delete authData.OPENAI_API_KEY;
      delete authData.auth_mode;

      // Write back or delete if empty
      if (Object.keys(authData).length === 0) {
        await fs.unlink(authPath);
      } else {
        await fs.writeFile(authPath, JSON.stringify(authData, null, 2));
      }
    } catch { /* No auth file */ }

    await fs.unlink(getCodexCatalogPath()).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });

    await updateSettings({ codexCliModels: [], codexCliModelNames: {}, codexCliModelContextSizes: {}, codexCliModelReasoningEfforts: {} }).catch(() => {});

    return NextResponse.json({
      success: true,
      message: "9Router settings removed successfully",
    });
  } catch (error) {
    console.log("Error resetting codex settings:", error);
    return NextResponse.json({ error: "Failed to reset codex settings" }, { status: 500 });
  }
}
