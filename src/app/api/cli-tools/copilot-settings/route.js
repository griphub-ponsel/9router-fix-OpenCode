"use server";

import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { findModelName } from "open-sse/config/providerModels.js";
import { getCopilotModelLimits } from "@/shared/utils/copilotModelLimits.js";
import { supportsCopilotVision } from "@/shared/utils/copilotModelCapabilities.js";
import { expandCopilotReasoningVariants } from "@/shared/utils/copilotReasoningVariants.js";
import { NOTION_REMOTE_MCP_PLUGIN } from "@/shared/constants/coworkPlugins";

// Resolve chatLanguageModels.json path per OS
const getConfigPath = () => {
  const home = os.homedir();
  const platform = os.platform();
  if (platform === "win32") {
    return path.join(process.env.APPDATA || home, "Code", "User", "chatLanguageModels.json");
  }
  if (platform === "darwin") {
    return path.join(home, "Library", "Application Support", "Code", "User", "chatLanguageModels.json");
  }
  return path.join(home, ".config", "Code", "User", "chatLanguageModels.json");
};

const getMcpConfigPath = () => {
  const home = os.homedir();
  const platform = os.platform();
  if (platform === "win32") {
    return path.join(process.env.APPDATA || home, "Code", "User", "mcp.json");
  }
  if (platform === "darwin") {
    return path.join(home, "Library", "Application Support", "Code", "User", "mcp.json");
  }
  return path.join(home, ".config", "Code", "User", "mcp.json");
};

const readConfig = async () => {
  try {
    const content = await fs.readFile(getConfigPath(), "utf-8");
    // Tolerate JSONC (trailing commas) and treat unparseable files as "no config"
    // rather than throwing a 500 that the UI misreads as "tool not installed".
    const stripped = content.replace(/,(\s*[}\]])/g, "$1");
    return JSON.parse(stripped);
  } catch (error) {
    return null;
  }
};

const has9RouterConfig = (config) => {
  if (!Array.isArray(config)) return false;
  return config.some((entry) => entry.name === "9Router");
};

const get9RouterEntry = (config) => {
  if (!Array.isArray(config)) return null;
  return config.find((entry) => entry.name === "9Router") || null;
};

const readJsonFile = async (configPath, fallback) => {
  try {
    const content = await fs.readFile(configPath, "utf-8");
    const stripped = content.replace(/,(\s*[}\]])/g, "$1");
    return JSON.parse(stripped);
  } catch {
    return fallback;
  }
};

const readMcpConfig = () => readJsonFile(getMcpConfigPath(), {});

async function writeNotionMcpConfig() {
  const configPath = getMcpConfigPath();
  const config = await readMcpConfig();
  if (!config.servers || typeof config.servers !== "object" || Array.isArray(config.servers)) config.servers = {};
  const existing = config.servers[NOTION_REMOTE_MCP_PLUGIN.name];
  const previous = existing && typeof existing === "object" && !Array.isArray(existing) ? existing : {};
  config.servers[NOTION_REMOTE_MCP_PLUGIN.name] = {
    ...previous,
    type: "http",
    url: NOTION_REMOTE_MCP_PLUGIN.url,
  };
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, JSON.stringify(config, null, 2));
  return configPath;
}

const getModelParts = (id) => {
  if (typeof id !== "string") return { alias: "", modelId: "" };
  const slash = id.indexOf("/");
  if (slash <= 0) return { alias: "", modelId: id };
  return { alias: id.slice(0, slash), modelId: id.slice(slash + 1) };
};

const resolveModelDisplayName = (id, modelNames = {}) => {
  const requested = typeof modelNames?.[id] === "string" ? modelNames[id].trim() : "";
  if (requested) return requested;

  const { alias, modelId } = getModelParts(id);
  if (alias && modelId) {
    const name = findModelName(alias, modelId);
    if (name && name !== modelId) return name;
  }
  return id;
};

// GET - Read current copilot config
export async function GET() {
  try {
    const config = await readConfig();
    const mcpConfig = await readMcpConfig();
    const entry = get9RouterEntry(config);

    return NextResponse.json({
      installed: true,
      config,
      has9Router: has9RouterConfig(config),
      configPath: getConfigPath(),
      mcpConfigPath: getMcpConfigPath(),
      hasNotionMcp: !!mcpConfig?.servers?.[NOTION_REMOTE_MCP_PLUGIN.name],
      currentModel: entry?.models?.[0]?.id || null,
      currentUrl: entry?.models?.[0]?.url || null,
    });
  } catch (error) {
    console.log("Error checking copilot settings:", error);
    return NextResponse.json({ error: "Failed to check copilot settings" }, { status: 500 });
  }
}

// POST - Apply 9Router config to chatLanguageModels.json
export async function POST(request) {
  try {
    const { baseUrl, apiKey, models, modelNames = {}, modelContextSizes = {} } = await request.json();

    if (!baseUrl || !models?.length) {
      return NextResponse.json({ error: "baseUrl and models are required" }, { status: 400 });
    }

    const configPath = getConfigPath();
    await fs.mkdir(path.dirname(configPath), { recursive: true });

    // Read existing config array
    let config = [];
    try {
      const existing = await fs.readFile(configPath, "utf-8");
      const parsed = JSON.parse(existing);
      config = Array.isArray(parsed) ? parsed : [];
    } catch { /* No existing config */ }

    const endpointUrl = `${baseUrl}/chat/completions`;
    const keyToUse = apiKey || "sk_9router";

    const baseModels = models.map((id) => ({
      id,
      name: resolveModelDisplayName(id, modelNames),
      url: endpointUrl,
      apiType: "chat-completions",
      toolCalling: true,
      vision: supportsCopilotVision(id),
      ...getCopilotModelLimits(id, modelContextSizes?.[id]),
    }));

    const newEntry = {
      name: "9Router",
      vendor: "customendpoint",
      apiKey: keyToUse,
      apiType: "chat-completions",
      models: expandCopilotReasoningVariants(baseModels),
    };

    // Replace existing 9Router entry or append
    const idx = config.findIndex((e) => e.name === "9Router");
    if (idx >= 0) {
      config[idx] = newEntry;
    } else {
      config.push(newEntry);
    }

    await fs.writeFile(configPath, JSON.stringify(config, null, 2));
    const mcpConfigPath = await writeNotionMcpConfig();

    return NextResponse.json({
      success: true,
      message: "Copilot Custom Endpoint and Notion MCP config applied. Reload VS Code to take effect.",
      configPath,
      mcpConfigPath,
    });
  } catch (error) {
    console.log("Error updating copilot settings:", error);
    return NextResponse.json({ error: "Failed to update copilot settings" }, { status: 500 });
  }
}

// DELETE - Remove 9Router entry from chatLanguageModels.json
export async function DELETE() {
  try {
    const configPath = getConfigPath();

    let config = [];
    try {
      const existing = await fs.readFile(configPath, "utf-8");
      const parsed = JSON.parse(existing);
      config = Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      if (error.code === "ENOENT") {
        return NextResponse.json({ success: true, message: "No config file to reset" });
      }
      throw error;
    }

    config = config.filter((e) => e.name !== "9Router");
    await fs.writeFile(configPath, JSON.stringify(config, null, 2));

    return NextResponse.json({
      success: true,
      message: "9Router removed from Copilot config",
    });
  } catch (error) {
    console.log("Error resetting copilot settings:", error);
    return NextResponse.json({ error: "Failed to reset copilot settings" }, { status: 500 });
  }
}
