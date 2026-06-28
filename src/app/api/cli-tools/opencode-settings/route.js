"use server";

import { NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { findModelName } from "open-sse/config/providerModels.js";
import { getCombos } from "@/lib/localDb";
import { NOTION_REMOTE_MCP_PLUGIN } from "@/shared/constants/coworkPlugins";

const execAsync = promisify(exec);

// Resolve a friendly display name for "<alias>/<modelId>" using the same
// PROVIDER_MODELS registry the dashboard uses. Falls back to the raw id when
// the alias is unknown (e.g. user-added custom model).
function resolveModelDisplayName(fullId) {
  if (typeof fullId !== "string" || fullId.length === 0) return fullId;
  const slash = fullId.indexOf("/");
  if (slash <= 0) return fullId;
  const alias = fullId.slice(0, slash);
  const modelId = fullId.slice(slash + 1);
  const name = findModelName(alias, modelId);
  return name && name !== modelId ? name : fullId;
}

const getConfigDir = () => path.join(os.homedir(), ".config", "opencode");
const getConfigPaths = () => [
  path.join(getConfigDir(), "opencode.jsonc"),
  path.join(getConfigDir(), "opencode.json"),
];

async function readConfig() {
  for (const configPath of getConfigPaths()) {
    try {
      const content = await fs.readFile(configPath, "utf-8");
      return { config: JSON.parse(content), configPath };
    } catch (error) {
      if (error.code === "ENOENT") continue;
      // Invalid JSON in one file should not block fallback to the other.
    }
  }
  return { config: null, configPath: null };
}

async function writeConfig(config) {
  const content = JSON.stringify(config, null, 2);
  const configPaths = getConfigPaths();
  await Promise.all(configPaths.map((p) => fs.writeFile(p, content)));
  return configPaths[0];
}

async function stripSelectedComboMembers(modelsArray) {
  if (!Array.isArray(modelsArray) || modelsArray.length === 0) return [];

  const combos = await getCombos();
  if (!Array.isArray(combos) || combos.length === 0) return modelsArray;

  const selectedComboNames = new Set(modelsArray.filter((m) => typeof m === "string" && !m.includes("/")));
  if (selectedComboNames.size === 0) return modelsArray;

  const comboMemberIds = new Set();
  for (const combo of combos) {
    if (!selectedComboNames.has(combo?.name)) continue;
    if (!Array.isArray(combo.models)) continue;
    for (const member of combo.models) {
      if (typeof member === "string" && member.includes("/")) {
        comboMemberIds.add(member);
      }
    }
  }

  if (comboMemberIds.size === 0) return modelsArray;
  return modelsArray.filter((m) => !comboMemberIds.has(m));
}

// Check if opencode CLI is installed (via which/where or config file exists)
const checkOpenCodeInstalled = async () => {
  try {
    const isWindows = os.platform() === "win32";
    const command = isWindows ? "where opencode" : "which opencode";
    const env = isWindows
      ? { ...process.env, PATH: `${process.env.APPDATA}\\npm;${process.env.PATH}` }
      : process.env;
    await execAsync(command, { windowsHide: true, env });
    return true;
  } catch {
    for (const configPath of getConfigPaths()) {
      try {
        await fs.access(configPath);
        return true;
      } catch {
        // try next path
      }
    }
    return false;
  }
};

const has9RouterConfig = (config) => {
  if (!config?.provider) return false;
  return !!config.provider["9router"];
};

function applyNotionMcpConfig(config) {
  if (!config.mcp || typeof config.mcp !== "object" || Array.isArray(config.mcp)) config.mcp = {};
  const existing = config.mcp[NOTION_REMOTE_MCP_PLUGIN.name];
  const previous = existing && typeof existing === "object" && !Array.isArray(existing) ? existing : {};
  config.mcp[NOTION_REMOTE_MCP_PLUGIN.name] = {
    ...previous,
    type: "remote",
    url: NOTION_REMOTE_MCP_PLUGIN.url,
    enabled: true,
    oauth: previous.oauth && typeof previous.oauth === "object" ? previous.oauth : {},
    timeout: previous.timeout || 30000,
  };
}

// GET - Check opencode CLI and read current settings
export async function GET() {
  try {
    const isInstalled = await checkOpenCodeInstalled();

    if (!isInstalled) {
      return NextResponse.json({
        installed: false,
        config: null,
        message: "OpenCode CLI is not installed",
      });
    }

    const { config, configPath } = await readConfig();
    const providerConfig = config?.provider?.["9router"];
    const modelMap = providerConfig?.models || {};
    const modelNames = Object.fromEntries(
      Object.entries(modelMap).map(([id, entry]) => [id, entry?.name || resolveModelDisplayName(id)])
    );

    return NextResponse.json({
      installed: true,
      config,
      has9Router: has9RouterConfig(config),
      configPath: configPath || getConfigPaths()[0],
      opencode: {
        models: Object.keys(modelMap),
        modelNames,
        activeModel: config?.model?.startsWith("9router/") ? config.model.replace(/^9router\//, "") : null,
        baseURL: providerConfig?.options?.baseURL || null,
        notionMcp: config?.mcp?.[NOTION_REMOTE_MCP_PLUGIN.name] || null,
      },
    });
  } catch (error) {
    console.log("Error checking opencode settings:", error);
    return NextResponse.json({ error: "Failed to check opencode settings" }, { status: 500 });
  }
}

// POST - Apply 9Router as openai-compatible provider (multi-model support)
export async function POST(request) {
  try {
    const { baseUrl, apiKey, model, models, activeModel, subagentModel, modelNames = {} } = await request.json();

    // Accept either `model` (string, legacy) or `models` (array of strings)
    const modelsArrayRaw = Array.isArray(models) ? models.slice() : (typeof model === "string" ? [model] : []);
    const modelsArray = await stripSelectedComboMembers(modelsArrayRaw);

    if (!baseUrl || modelsArray.length === 0) {
      return NextResponse.json({ error: "baseUrl and at least one model are required" }, { status: 400 });
    }

    const configDir = getConfigDir();
    await fs.mkdir(configDir, { recursive: true });

    // Read existing config or start fresh
    const readResult = await readConfig();
    const config = readResult.config || {};

    const normalizedBaseUrl = baseUrl.endsWith("/v1") ? baseUrl : `${baseUrl}/v1`;
    const keyToUse = apiKey || "sk_9router";
    const effectiveSubagentModel = subagentModel || modelsArray[0];

    // Ensure provider object
    if (!config.provider) config.provider = {};

    // Preserve any existing 9router provider entry and its models
    const existingProvider = config.provider["9router"] || { npm: "@ai-sdk/openai-compatible", options: {}, models: {} };

    // Merge options (overwrite baseURL/apiKey)
    existingProvider.options = {
      ...existingProvider.options,
      baseURL: normalizedBaseUrl,
      apiKey: keyToUse,
    };

    const previousModels = existingProvider.models || {};
    const nextModels = {};

    // Add or update entries for all requested models
    for (const m of modelsArray) {
      if (!m || typeof m !== "string") continue;
      // Preserve any existing per-model overrides, but always advertise the
      // capabilities OpenCode's UI gates on. Without these the UI rejects
      // attachments client-side ("this model does not support image input")
      // before the request reaches 9router.
      //
      // Schema reference: https://opencode.ai/config.json (ProviderConfig.models)
      //   - `attachment: true` enables the paperclip / drag-drop affordance
      //   - `modalities.input: ["text","image"]` tells the UI the model
      //     actually accepts the attachment (this is the field that gates the
      //     "this model does not support image input" error)
      //   - `tool_call: true`, `reasoning: true`, `temperature: true` keep
      //     other UI features unlocked
      const existingModel = previousModels[m] || {};
      const existingModalities = existingModel.modalities || {};
      // Pull the friendly display name from the 9router registry so OpenCode
      // shows e.g. "Claude Opus 4.7" instead of the raw id "kr/claude-opus-4.7".
      // We always recompute it on apply so users get fresh names when the
      // registry updates, but never overwrite a name a user already customized
      // by hand (i.e. one that differs from both the id AND the resolved name).
      const resolvedName = resolveModelDisplayName(m);
      const requestedName = typeof modelNames?.[m] === "string" ? modelNames[m].trim() : "";
      const previousName = existingModel.name;
      const previousResolved = resolveModelDisplayName(m);
      const userCustomizedName =
        previousName &&
        previousName !== m &&
        previousName !== previousResolved;
      const finalName = requestedName || (userCustomizedName ? previousName : resolvedName);
      nextModels[m] = {
        ...existingModel,
        name: finalName,
        attachment: true,
        tool_call: true,
        reasoning: true,
        temperature: true,
        modalities: {
          input: existingModalities.input || ["text", "image"],
          output: existingModalities.output || ["text"],
        },
      };
    }

    // Keep only currently selected models to prevent stale entries from staying
    // in opencode.json (previous behavior merged forever and caused duplicates).
    existingProvider.models = nextModels;

    // Save merged provider back
    config.provider["9router"] = existingProvider;

    // Set the active model: prefer explicit activeModel, else first of modelsArray
    // If activeModel is explicitly empty string, clear the model
    if (activeModel === "") {
      config.model = "";
    } else {
      const finalActive = activeModel || modelsArray[0];
      if (finalActive) {
        config.model = `9router/${finalActive}`;
      }
    }

    // Add subagent configuration
    if (!config.agent) config.agent = {};
    config.agent.explorer = {
      description: "Fast explorer subagent for codebase exploration",
      mode: "subagent",
      model: `9router/${effectiveSubagentModel}`,
    };
    applyNotionMcpConfig(config);

    const configPath = await writeConfig(config);

    return NextResponse.json({
      success: true,
      message: "OpenCode settings applied successfully!",
      configPath,
    });
  } catch (error) {
    console.log("Error applying opencode settings:", error);
    return NextResponse.json({ error: "Failed to apply settings" }, { status: 500 });
  }
}

// PATCH - Update specific settings (e.g., clear active model)
export async function PATCH(request) {
  try {
    const { clearActiveModel } = await request.json();
    const readResult = await readConfig();
    const configPath = readResult.configPath || getConfigPaths()[0];
    const config = readResult.config;
    if (!config) return NextResponse.json({ success: true, message: "No config file found" });

    if (clearActiveModel === true) {
      // Clear active model but keep models in the list
      if (config.model?.startsWith("9router/")) {
        config.model = "";
      }
    }

    await writeConfig(config);

    return NextResponse.json({
      success: true,
      message: "Settings updated",
    });
  } catch (error) {
    console.log("Error patching opencode settings:", error);
    return NextResponse.json({ error: "Failed to patch settings" }, { status: 500 });
  }
}

// DELETE - Remove 9Router provider or specific models from config
export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const modelToRemove = searchParams.get("model");
    const readResult = await readConfig();
    const config = readResult.config;
    if (!config) return NextResponse.json({ success: true, message: "No config file to reset" });

    // If specific model provided, remove just that model
    if (modelToRemove && config.provider?.["9router"]?.models) {
      delete config.provider["9router"].models[modelToRemove];
      
      // If no models left, remove the provider
      if (Object.keys(config.provider["9router"].models).length === 0) {
        delete config.provider["9router"];
        if (config.model?.startsWith("9router/")) delete config.model;
      } else if (config.model === `9router/${modelToRemove}`) {
        // If removed model was active, switch to first remaining model
        const remainingModels = Object.keys(config.provider["9router"].models);
        config.model = `9router/${remainingModels[0]}`;
      }
    } else {
      // No specific model - remove entire 9router provider
      if (config.provider) delete config.provider["9router"];
      if (config.model?.startsWith("9router/")) delete config.model;
    }

    // Remove subagent configuration
    if (config.agent?.explorer?.model?.startsWith("9router/")) {
      delete config.agent.explorer;
      // Clean up empty agent object
      if (Object.keys(config.agent).length === 0) delete config.agent;
    }

    await writeConfig(config);

    return NextResponse.json({
      success: true,
      message: modelToRemove ? `Model "${modelToRemove}" removed` : "9Router settings removed from OpenCode",
    });
  } catch (error) {
    console.log("Error resetting opencode settings:", error);
    return NextResponse.json({ error: "Failed to reset opencode settings" }, { status: 500 });
  }
}
