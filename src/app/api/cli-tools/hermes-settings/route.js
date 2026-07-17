"use server";

import { NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { deleteModelAlias, getModelAliases, setModelAlias } from "@/models";
import {
  API_KEY_ENV,
  PROVIDER_NAME,
  readHermesConfig,
  removeHermesConfig,
  writeHermesConfig,
} from "./configYaml.mjs";

const execAsync = promisify(exec);

const getHermesDir = () => path.join(os.homedir(), ".hermes");
const getHermesConfigPath = () => path.join(getHermesDir(), "config.yaml");
const getHermesEnvPath = () => path.join(getHermesDir(), ".env");

// .env helpers — upsert/remove single KEY=VALUE line
const upsertEnvVar = (envText, key, value) => {
  const re = new RegExp(`^${key}=.*$`, "m");
  const line = `${key}=${value}`;
  if (re.test(envText)) return envText.replace(re, line);
  return envText.length > 0 && !envText.endsWith("\n") ? `${envText}\n${line}\n` : `${envText}${line}\n`;
};

const removeEnvVar = (envText, key) => {
  const re = new RegExp(`^${key}=.*\\r?\\n?`, "m");
  return envText.replace(re, "");
};

const checkHermesInstalled = async () => {
  try {
    const isWindows = os.platform() === "win32";
    const command = isWindows ? "where hermes" : "which hermes";
    await execAsync(command, { windowsHide: true });
    return true;
  } catch {
    try {
      await fs.access(getHermesConfigPath());
      return true;
    } catch {
      return false;
    }
  }
};

const readConfigYaml = async () => {
  try {
    return await fs.readFile(getHermesConfigPath(), "utf-8");
  } catch (error) {
    if (error.code === "ENOENT") return "";
    throw error;
  }
};

const readEnvFile = async () => {
  try {
    return await fs.readFile(getHermesEnvPath(), "utf-8");
  } catch (error) {
    if (error.code === "ENOENT") return "";
    throw error;
  }
};

// Detect 9router by base_url containing localhost/127.0.0.1 or matching tunnel URL
const has9RouterConfig = (modelCfg) => {
  if (!modelCfg?.base_url) return false;
  return ["custom", PROVIDER_NAME].includes(modelCfg.provider)
    && /localhost|127\.0\.0\.1|0\.0\.0\.0/.test(modelCfg.base_url);
};

const getDisplayAliases = (models, modelNames) => Object.fromEntries(
  models.flatMap((targetModel) => {
    const displayName = typeof modelNames?.[targetModel] === "string" ? modelNames[targetModel].trim() : "";
    return displayName && displayName !== targetModel ? [[displayName, targetModel]] : [];
  })
);

export async function GET() {
  try {
    const installed = await checkHermesInstalled();
    if (!installed) {
      return NextResponse.json({ installed: false, settings: null, message: "Hermes Agent is not installed" });
    }
    const yaml = await readConfigYaml();
    const { model, models, modelNames, modelContextLengths } = readHermesConfig(yaml);
    return NextResponse.json({
      installed: true,
      settings: { model, models, modelNames, modelContextLengths },
      has9Router: has9RouterConfig(model),
      configPath: getHermesConfigPath(),
    });
  } catch (error) {
    console.log("Error checking hermes settings:", error);
    return NextResponse.json({ error: "Failed to check hermes settings" }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const { baseUrl, apiKey, model, models, modelNames = {}, modelContextLengths = {} } = await request.json();
    const selectedModels = Array.from(new Set(
      (Array.isArray(models) ? models : [model])
        .filter((value) => typeof value === "string" && value.trim())
        .map((value) => value.trim())
    ));
    const defaultModel = typeof model === "string" ? model.trim() : "";
    if (!baseUrl || !defaultModel || selectedModels.length === 0) {
      return NextResponse.json({ error: "baseUrl, model, and models are required" }, { status: 400 });
    }
    if (!selectedModels.includes(defaultModel)) {
      return NextResponse.json({ error: "Default model must be included in models" }, { status: 400 });
    }
    const normalizedModelContextLengths = {};
    for (const selectedModel of selectedModels) {
      const rawContextLength = modelContextLengths?.[selectedModel];
      if (rawContextLength == null || rawContextLength === "") continue;
      const contextLength = Number(rawContextLength);
      if (!Number.isSafeInteger(contextLength) || contextLength < 1024) {
        return NextResponse.json({ error: `Context length for '${selectedModel}' must be an integer of at least 1024` }, { status: 400 });
      }
      normalizedModelContextLengths[selectedModel] = contextLength;
    }

    const displayAliases = getDisplayAliases(selectedModels, modelNames);
    const pickerIds = selectedModels.map((targetModel) => (
      (typeof modelNames?.[targetModel] === "string" && modelNames[targetModel].trim()) || targetModel
    ));
    if (Object.keys(displayAliases).some((displayName) => displayName.includes("/"))) {
      return NextResponse.json({ error: "Hermes display names cannot contain '/'" }, { status: 400 });
    }
    if (new Set(pickerIds).size !== pickerIds.length) {
      return NextResponse.json({ error: "Hermes display names must be unique" }, { status: 400 });
    }

    const dir = getHermesDir();
    await fs.mkdir(dir, { recursive: true });

    const normalizedBaseUrl = baseUrl.endsWith("/v1") ? baseUrl : `${baseUrl}/v1`;

    // Update config.yaml — replace/insert model: block, keep everything else
    const existingYaml = await readConfigYaml();
    const previousConfig = readHermesConfig(existingYaml);
    const previousDisplayAliases = getDisplayAliases(previousConfig.models, previousConfig.modelNames);
    const existingAliases = await getModelAliases();
    const conflict = Object.entries(displayAliases).find(
      ([displayName, targetModel]) => existingAliases[displayName] && existingAliases[displayName] !== targetModel
    );
    if (conflict) {
      return NextResponse.json({ error: `Display name '${conflict[0]}' is already used by another model` }, { status: 409 });
    }

    for (const [displayName, targetModel] of Object.entries(previousDisplayAliases)) {
      if (!displayAliases[displayName] && existingAliases[displayName] === targetModel) {
        await deleteModelAlias(displayName);
      }
    }
    for (const [displayName, targetModel] of Object.entries(displayAliases)) {
      await setModelAlias(displayName, targetModel);
    }

    const newYaml = writeHermesConfig(existingYaml, {
      models: selectedModels,
      modelNames,
      modelContextLengths: normalizedModelContextLengths,
      defaultModel,
      baseUrl: normalizedBaseUrl,
    });
    await fs.writeFile(getHermesConfigPath(), newYaml);

    // Update .env — upsert OPENAI_API_KEY only when caller provides one
    if (apiKey) {
      const existingEnv = await readEnvFile();
      const newEnv = upsertEnvVar(existingEnv, API_KEY_ENV, apiKey);
      await fs.writeFile(getHermesEnvPath(), newEnv);
    }

    return NextResponse.json({
      success: true,
      message: "Hermes settings applied successfully!",
      configPath: getHermesConfigPath(),
    });
  } catch (error) {
    console.log("Error updating hermes settings:", error);
    return NextResponse.json({ error: "Failed to update hermes settings" }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    const configPath = getHermesConfigPath();
    let yaml = "";
    try {
      yaml = await fs.readFile(configPath, "utf-8");
    } catch (error) {
      if (error.code === "ENOENT") {
        return NextResponse.json({ success: true, message: "No config file to reset" });
      }
      throw error;
    }
    const existingConfig = readHermesConfig(yaml);
    const displayAliases = getDisplayAliases(existingConfig.models, existingConfig.modelNames);
    const existingAliases = await getModelAliases();
    for (const [displayName, targetModel] of Object.entries(displayAliases)) {
      if (existingAliases[displayName] === targetModel) {
        await deleteModelAlias(displayName);
      }
    }
    const newYaml = removeHermesConfig(yaml);
    await fs.writeFile(configPath, newYaml);
    return NextResponse.json({ success: true, message: `${PROVIDER_NAME} model block removed` });
  } catch (error) {
    console.log("Error resetting hermes settings:", error);
    return NextResponse.json({ error: "Failed to reset hermes settings" }, { status: 500 });
  }
}
