import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;

async function setupDb() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-model-routing-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();

  const { createCombo, createProviderNode, setModelAlias } = await import("@/models/index.js");
  const { getComboModels, getModelInfo } = await import("@/sse/services/model.js");

  return {
    createCombo,
    createProviderNode,
    getComboModels,
    getModelInfo,
    setModelAlias,
    cleanup() {
      fs.rmSync(tempDir, { recursive: true, force: true });
    },
  };
}

describe("model routing", () => {
  let cleanup = () => {};

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    cleanup();
    cleanup = () => {};
    if (originalDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = originalDataDir;
  });

  it("keeps built-in provider aliases ahead of compatible node prefixes", async () => {
    const ctx = await setupDb();
    cleanup = ctx.cleanup;

    await ctx.createProviderNode({
      id: "openai-compatible-chat-test",
      type: "openai-compatible",
      name: "Compatible CF Collision",
      prefix: "cf",
      apiType: "chat",
      baseUrl: "https://compatible.test/v1",
    });

    await expect(ctx.getModelInfo("cf/@cf/black-forest-labs/flux-2-klein-9b"))
      .resolves.toEqual({
        provider: "cloudflare-ai",
        model: "@cf/black-forest-labs/flux-2-klein-9b",
      });
  });

  it("still routes non-reserved compatible node prefixes", async () => {
    const ctx = await setupDb();
    cleanup = ctx.cleanup;

    await ctx.createProviderNode({
      id: "openai-compatible-chat-test",
      type: "openai-compatible",
      name: "Compatible OCT",
      prefix: "oct",
      apiType: "chat",
      baseUrl: "https://compatible.test/v1",
    });

    await expect(ctx.getModelInfo("oct/gpt-image-1"))
      .resolves.toEqual({
        provider: "openai-compatible-chat-test",
        model: "gpt-image-1",
      });
  });

  it("resolves a friendly model alias to a combo", async () => {
    const ctx = await setupDb();
    cleanup = ctx.cleanup;

    await ctx.createCombo({
      name: "deepseek-v4",
      models: ["or/deepseek-v4", "cl/deepseek-v4"],
      kind: "fallback",
    });
    await ctx.setModelAlias("DeepSeek V4 Auto", "deepseek-v4");

    await expect(ctx.getComboModels("DeepSeek V4 Auto"))
      .resolves.toEqual(["or/deepseek-v4", "cl/deepseek-v4"]);
  });

  it("keeps a direct combo id routable when its model alias is a display label", async () => {
    const ctx = await setupDb();
    cleanup = ctx.cleanup;

    await ctx.createCombo({
      name: "kimi-k3",
      models: ["cl/cline-pass/kimi-k3", "cbcn/kimi-k3"],
      kind: "fallback",
    });
    await ctx.setModelAlias("kimi-k3", "Kimi K3");

    await expect(ctx.getComboModels("kimi-k3"))
      .resolves.toEqual(["cl/cline-pass/kimi-k3", "cbcn/kimi-k3"]);
  });
});
