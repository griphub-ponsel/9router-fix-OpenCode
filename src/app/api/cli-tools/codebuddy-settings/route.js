"use server";

import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { findModelName } from "open-sse/config/providerModels.js";

// Resolve a friendly display name for "<alias>/<modelId>" using the same
// PROVIDER_MODELS registry the dashboard uses.
function resolveModelDisplayName(fullId) {
  if (typeof fullId !== "string" || fullId.length === 0) return fullId;
  const slash = fullId.indexOf("/");
  if (slash <= 0) return fullId;
  const alias = fullId.slice(0, slash);
  const modelId = fullId.slice(slash + 1);
  const name = findModelName(alias, modelId);
  return name && name !== modelId ? name : fullId;
}

const getConfigDir = () => path.join(os.homedir(), ".codebuddy");
const getModelsPath = () => path.join(getConfigDir(), "models.json");

const checkInstalled = async () => {
  try {
    await fs.access(getModelsPath());
    return true;
  } catch {
    return false;
  }
};

async function readConfig() {
  try {
    const content = await fs.readFile(getModelsPath(), "utf-8");
    return JSON.parse(content);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function writeConfig(config) {
  const content = JSON.stringify(config, null, 2);
  await fs.writeFile(getModelsPath(), content);
}

const has9RouterConfig = (config) => {
  if (!config || !Array.isArray(config.models)) return false;
  return config.models.some(
    (m) =>
      m.vendor === "9router" ||
      m.url?.includes("127.0.0.1") ||
      m.url?.includes("localhost") ||
      m.url?.includes("9router")
  );
};

// GET - Check codebuddy and read current settings
export async function GET() {
  try {
    const installed = await checkInstalled();
    if (!installed) {
      return NextResponse.json({
        installed: false,
        config: null,
        message: "CodeBuddy is not installed",
      });
    }

    const config = await readConfig();
    const modelsList = config?.models || [];
    const cbModels = modelsList.filter(
      (m) =>
        m.vendor === "9router" ||
        m.url?.includes("127.0.0.1") ||
        m.url?.includes("localhost") ||
        m.url?.includes("9router")
    );
    const modelIds = cbModels.map((m) => m.id);
    const modelNames = Object.fromEntries(
      cbModels.map((m) => [m.id, m.name || resolveModelDisplayName(m.id)])
    );

    const firstCbModel = cbModels[0];
    const baseURL = firstCbModel?.url || null;

    return NextResponse.json({
      installed: true,
      config,
      has9Router: has9RouterConfig(config),
      configPath: getModelsPath(),
      codebuddy: {
        models: modelIds,
        modelNames,
        baseURL,
      },
    });
  } catch (error) {
    console.log("Error checking codebuddy settings:", error);
    return NextResponse.json({ error: "Failed to check codebuddy settings" }, { status: 500 });
  }
}

// POST - Apply 9Router models to codebuddy
export async function POST(request) {
  try {
    const { baseUrl, apiKey, models, modelNames = {} } = await request.json();
    const modelsArray = Array.isArray(models) ? models : [];

    if (!baseUrl || modelsArray.length === 0) {
      return NextResponse.json({ error: "baseUrl and at least one model are required" }, { status: 400 });
    }

    await fs.mkdir(getConfigDir(), { recursive: true });

    const config = (await readConfig()) || { models: [] };
    if (!Array.isArray(config.models)) {
      config.models = [];
    }

    const normalizedBaseUrl = baseUrl.endsWith("/v1") ? baseUrl : `${baseUrl}/v1`;
    const keyToUse = apiKey || "sk_9router";

    // 1. Keep other vendors' models (non-9router models)
    const otherModels = config.models.filter(
      (m) =>
        m.vendor !== "9router" &&
        !m.url?.includes("127.0.0.1") &&
        !m.url?.includes("localhost") &&
        !m.url?.includes("9router")
    );

    // 2. Build new list of 9router models
    const newCbModels = modelsArray.map((mId) => {
      const resolvedName = resolveModelDisplayName(mId);
      const requestedName = typeof modelNames?.[mId] === "string" ? modelNames[mId].trim() : "";
      const finalName = requestedName || resolvedName;

      // Reasoning support detection
      const supportsReasoning = !mId.toLowerCase().includes("non-reasoning");

      return {
        id: mId,
        name: finalName,
        vendor: "9router",
        url: normalizedBaseUrl,
        apiKey: keyToUse,
        supportsToolCall: true,
        supportsImages: true,
        supportsReasoning,
      };
    });

    config.models = [...otherModels, ...newCbModels];

    await writeConfig(config);

    return NextResponse.json({
      success: true,
      message: "CodeBuddy settings applied successfully!",
      configPath: getModelsPath(),
    });
  } catch (error) {
    console.log("Error applying codebuddy settings:", error);
    return NextResponse.json({ error: "Failed to apply settings" }, { status: 500 });
  }
}

// DELETE - Remove 9Router provider or specific models from config
export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const modelToRemove = searchParams.get("model");
    const config = await readConfig();

    if (!config || !Array.isArray(config.models)) {
      return NextResponse.json({ success: true, message: "No settings to reset" });
    }

    if (modelToRemove) {
      // Remove specific model
      config.models = config.models.filter((m) => m.id !== modelToRemove);
    } else {
      // Remove all 9router models
      config.models = config.models.filter(
        (m) =>
          m.vendor !== "9router" &&
          !m.url?.includes("127.0.0.1") &&
          !m.url?.includes("localhost") &&
          !m.url?.includes("9router")
      );
    }

    await writeConfig(config);

    return NextResponse.json({
      success: true,
      message: modelToRemove ? `Model "${modelToRemove}" removed` : "9Router settings removed from CodeBuddy",
    });
  } catch (error) {
    console.log("Error resetting codebuddy settings:", error);
    return NextResponse.json({ error: "Failed to reset settings" }, { status: 500 });
  }
}
