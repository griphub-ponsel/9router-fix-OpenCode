import assert from "node:assert/strict";
import test from "node:test";
import {
  readHermesConfig,
  removeHermesConfig,
  writeHermesConfig,
} from "../../src/app/api/cli-tools/hermes-settings/configYaml.mjs";

const config = {
  models: ["deepseek-v4", "cx/gpt-5.5", "ollama-local/qwen2.5:7b"],
  modelNames: {
    "deepseek-v4": "DeepSeek V4 Auto",
    "cx/gpt-5.5": "GPT 5.5 Codex",
    "ollama-local/qwen2.5:7b": "Qwen 2.5 Local",
  },
  defaultModel: "deepseek-v4",
  baseUrl: "http://127.0.0.1:20128/v1",
  modelContextLengths: {
    "deepseek-v4": 262144,
    "cx/gpt-5.5": 1048576,
  },
};

test("writes and reads a curated Hermes model list with one default", () => {
  const yaml = writeHermesConfig("", config);

  assert.match(yaml, /provider: "9router"/);
  assert.match(yaml, /discover_models: false/);
  assert.match(yaml, /default: "DeepSeek V4 Auto"/);
  assert.doesNotMatch(yaml, /^  context_length:/m);
  assert.match(yaml, /"DeepSeek V4 Auto":\n        target_model: "deepseek-v4"\n        display_name: "DeepSeek V4 Auto"\n        context_length: 262144/);
  assert.match(yaml, /"GPT 5.5 Codex":\n        target_model: "cx\/gpt-5.5"\n        display_name: "GPT 5.5 Codex"\n        context_length: 1048576/);
  assert.doesNotMatch(yaml, /^      "deepseek-v4":/m);
  assert.deepEqual(readHermesConfig(yaml), {
    model: {
      default: "deepseek-v4",
      provider: "9router",
      base_url: "http://127.0.0.1:20128/v1",
    },
    models: config.models,
    modelNames: config.modelNames,
    modelContextLengths: config.modelContextLengths,
  });
});

test("preserves unrelated settings and providers when applying 9Router", () => {
  const existing = `agent:\n  max_turns: 42\n\nproviders:\n  local:\n    name: "Local"\n    base_url: "http://localhost:11434/v1"\n`;
  const yaml = writeHermesConfig(existing, config);

  assert.match(yaml, /agent:\n  max_turns: 42/);
  assert.match(yaml, /  local:\n    name: "Local"/);
  assert.equal((yaml.match(/^  9router:/gm) || []).length, 1);
});

test("omits per-model context length when auto-detection is selected", () => {
  const yaml = writeHermesConfig("", { ...config, modelContextLengths: {} });

  assert.doesNotMatch(yaml, /context_length:/);
  assert.deepEqual(readHermesConfig(yaml).modelContextLengths, {});
});

test("preserves the model order supplied by the picker", () => {
  const sortedModels = [...config.models].sort((left, right) => left.localeCompare(right));
  const yaml = writeHermesConfig("", { ...config, models: sortedModels });

  assert.deepEqual(readHermesConfig(yaml).models, sortedModels);
});

test("replaces an existing managed provider without keeping stale models", () => {
  const first = writeHermesConfig("", {
    models: ["old-model"],
    modelNames: { "old-model": "Old Display Name" },
    defaultModel: "old-model",
    baseUrl: "http://127.0.0.1:20128/v1",
  });
  const updated = writeHermesConfig(first, config);

  assert.doesNotMatch(updated, /old-model/);
  assert.doesNotMatch(updated, /Old Display Name/);
  assert.equal((updated.match(/^  9router:/gm) || []).length, 1);
  assert.deepEqual(readHermesConfig(updated).models, config.models);
});

test("reset removes only the managed model and provider blocks", () => {
  const existing = `agent:\n  max_turns: 42\n\nproviders:\n  local:\n    name: "Local"\n    base_url: "http://localhost:11434/v1"\n`;
  const yaml = writeHermesConfig(existing, config);
  const reset = removeHermesConfig(yaml);

  assert.doesNotMatch(reset, /^model:/m);
  assert.doesNotMatch(reset, /^  9router:/m);
  assert.match(reset, /agent:\n  max_turns: 42/);
  assert.match(reset, /providers:\n  local:/);
});