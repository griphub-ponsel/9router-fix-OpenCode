import path from "path";
import { readHermesConfig, writeHermesConfig } from "./configYaml.mjs";

const CONFIG_FILE = "config.yaml";

const pathExists = async (fs, target) => {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
};

export const listHermesConfigPaths = async (fs, hermesDir) => {
  const paths = [path.join(hermesDir, CONFIG_FILE)];
  const profilesDir = path.join(hermesDir, "profiles");
  try {
    const entries = await fs.readdir(profilesDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const configPath = path.join(profilesDir, entry.name, CONFIG_FILE);
      if (await pathExists(fs, configPath)) paths.push(configPath);
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  return paths;
};

export const resolveHermesContextLengths = (
  models,
  overrides = {},
  catalogModels = [],
  savedContextLengths = {}
) => {
  const liveContexts = new Map(
    catalogModels.flatMap((entry) => {
      const contextLength = Number(entry?.capabilities?.contextWindow);
      return typeof entry?.id === "string" && Number.isSafeInteger(contextLength) && contextLength >= 1024
        ? [[entry.id, contextLength]]
        : [];
    })
  );
  return Object.fromEntries(models.flatMap((model) => {
    const override = Number(overrides?.[model]);
    if (Number.isSafeInteger(override) && override >= 1024) return [[model, override]];
    const saved = Number(savedContextLengths?.[model]);
    if (Number.isSafeInteger(saved) && saved >= 1024) return [[model, saved]];
    const detected = liveContexts.get(model);
    return detected ? [[model, detected]] : [];
  }));
};

export const syncHermesProfileConfigs = async (fs, hermesDir, settings) => {
  const configPaths = await listHermesConfigPaths(fs, hermesDir);
  const selectedModels = new Set(settings.models);
  const staged = [];

  try {
    for (const configPath of configPaths) {
      let existingYaml = "";
      try {
        existingYaml = await fs.readFile(configPath, "utf-8");
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }

      const existing = readHermesConfig(existingYaml);
      const profileDefault = existing.model?.provider === "9router"
        && selectedModels.has(existing.model.default)
        ? existing.model.default
        : settings.defaultModel;
      const nextYaml = writeHermesConfig(existingYaml, {
        ...settings,
        defaultModel: profileDefault,
      });
      const tempPath = `${configPath}.9router-sync-${process.pid}-${Date.now()}-${staged.length}`;
      await fs.writeFile(tempPath, nextYaml, { mode: 0o600 });
      staged.push({ configPath, tempPath, defaultModel: profileDefault });
    }

    for (const item of staged) await fs.rename(item.tempPath, item.configPath);
    return {
      updated: staged.length,
      profiles: staged.map(({ configPath, defaultModel }) => ({ configPath, defaultModel })),
    };
  } catch (error) {
    await Promise.all(staged.map(({ tempPath }) => fs.unlink(tempPath).catch(() => {})));
    throw error;
  }
};
