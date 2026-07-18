import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { readHermesConfig, writeHermesConfig } from "../../src/app/api/cli-tools/hermes-settings/configYaml.mjs";
import {
  resolveHermesContextLengths,
  syncHermesProfileConfigs,
} from "../../src/app/api/cli-tools/hermes-settings/profileSync.mjs";

const catalog = {
  models: ["cx/gpt-5.6-sol", "cx/gpt-5.6-luna", "deepseek-v4-flash"],
  modelNames: {
    "cx/gpt-5.6-sol": "GPT 5.6 Sol",
    "cx/gpt-5.6-luna": "GPT 5.6 Luna",
    "deepseek-v4-flash": "Deepseek V4 Flash",
  },
  modelContextLengths: {
    "cx/gpt-5.6-sol": 1_000_000,
    "cx/gpt-5.6-luna": 1_000_000,
    "deepseek-v4-flash": 1_000_000,
  },
  defaultModel: "cx/gpt-5.6-sol",
  baseUrl: "http://127.0.0.1:20128/v1",
};

test("auto context is read from the live 9Router catalog and manual overrides win", () => {
  const result = resolveHermesContextLengths(
    ["cx/gpt-5.6-sol", "new/model", "unknown/model"],
    { "cx/gpt-5.6-sol": 400_000 },
    [
      { id: "cx/gpt-5.6-sol", capabilities: { contextWindow: 1_000_000 } },
      { id: "new/model", capabilities: { contextWindow: 1_048_576 } },
      { id: "broken/model", capabilities: { contextWindow: "invalid" } },
    ]
  );
  assert.deepEqual(result, {
    "cx/gpt-5.6-sol": 400_000,
    "new/model": 1_048_576,
  });
});

test("one Hermes save syncs every existing profile while preserving per-profile defaults", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "hermes-sync-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, "profiles", "kerjaan"), { recursive: true });
  await fs.mkdir(path.join(root, "profiles", "saham"), { recursive: true });

  const rootYaml = writeHermesConfig("agent:\n  max_turns: 60\n", { ...catalog, models: catalog.models.slice(0, 2) });
  const kerjaanYaml = writeHermesConfig("gateway:\n  enabled: true\n", {
    ...catalog,
    models: catalog.models.slice(0, 2),
    defaultModel: "cx/gpt-5.6-luna",
  });
  const sahamYaml = writeHermesConfig("platforms:\n  telegram:\n    enabled: true\n", {
    ...catalog,
    models: ["removed-model"],
    modelNames: { "removed-model": "Removed" },
    modelContextLengths: {},
    defaultModel: "removed-model",
  });
  await fs.writeFile(path.join(root, "config.yaml"), rootYaml);
  await fs.writeFile(path.join(root, "profiles", "kerjaan", "config.yaml"), kerjaanYaml);
  await fs.writeFile(path.join(root, "profiles", "saham", "config.yaml"), sahamYaml);

  const result = await syncHermesProfileConfigs(fs, root, catalog);
  assert.equal(result.updated, 3);

  const rootOut = await fs.readFile(path.join(root, "config.yaml"), "utf-8");
  const kerjaanOut = await fs.readFile(path.join(root, "profiles", "kerjaan", "config.yaml"), "utf-8");
  const sahamOut = await fs.readFile(path.join(root, "profiles", "saham", "config.yaml"), "utf-8");
  assert.deepEqual(readHermesConfig(rootOut).models, catalog.models);
  assert.deepEqual(readHermesConfig(kerjaanOut).models, catalog.models);
  assert.deepEqual(readHermesConfig(sahamOut).models, catalog.models);
  assert.equal(readHermesConfig(kerjaanOut).model.default, "cx/gpt-5.6-luna");
  assert.equal(readHermesConfig(sahamOut).model.default, "cx/gpt-5.6-sol");
  assert.match(kerjaanOut, /gateway:\n  enabled: true/);
  assert.match(sahamOut, /platforms:\n  telegram:/);
});