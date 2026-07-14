import { describe, expect, it } from "vitest";

import { expandCopilotReasoningVariants } from "../../src/shared/utils/copilotReasoningVariants.js";

describe("expandCopilotReasoningVariants", () => {
  it("exposes xhigh/max for opus 4.7 selected by model id", () => {
    const [model] = expandCopilotReasoningVariants([{ id: "cc/claude-opus-4-7" }]);
    expect(model.thinking).toBe(true);
    expect(model.supportsReasoningEffort).toEqual(["low", "medium", "high", "xhigh", "max"]);
  });

  it.each(["luna", "sol", "terra"])("exposes native max for GPT 5.6 %s", (variant) => {
    const [model] = expandCopilotReasoningVariants([{ id: `cx/gpt-5.6-${variant}` }]);
    expect(model.supportsReasoningEffort).toEqual(["low", "medium", "high", "xhigh", "max"]);
  });

  it("falls back to low/medium/high for an unknown model", () => {
    const [model] = expandCopilotReasoningVariants([{ id: "cc/claude-haiku-4-5" }]);
    expect(model.supportsReasoningEffort).toEqual(["low", "medium", "high"]);
  });

  it("exposes xhigh/max for every Kiro live-catalog model", () => {
    for (const id of [
      "kr/claude-sonnet-5",
      "kr/claude-haiku-4.5",
      "kr/deepseek-3.2",
      "kiro/qwen3-coder-next",
    ]) {
      const [model] = expandCopilotReasoningVariants([{ id }]);
      expect(model.thinking, id).toBe(true);
      expect(model.supportsReasoningEffort, id).toEqual(["low", "medium", "high", "xhigh", "max"]);
    }
  });

  it("resolves a combo to the union of its members' efforts (incl. max)", () => {
    const combos = [{ name: "maximize-claude", models: ["cc/claude-opus-4-7", "cc/claude-haiku-4-5"] }];
    const [model] = expandCopilotReasoningVariants([{ id: "maximize-claude" }], combos);
    expect(model.thinking).toBe(true);
    expect(model.supportsReasoningEffort).toEqual(["low", "medium", "high", "xhigh", "max"]);
  });

  it("orders combo efforts low→max regardless of member order", () => {
    const combos = [{ name: "mixed", models: ["cc/claude-opus-4-6", "gemini/gemini-3.1-pro"] }];
    const [model] = expandCopilotReasoningVariants([{ id: "mixed" }], combos);
    expect(model.supportsReasoningEffort).toEqual(["low", "medium", "high", "xhigh", "max"]);
  });

  it("leaves a combo untouched when no member supports reasoning", () => {
    const combos = [{ name: "no-think", models: ["oai/text-embedding-3-large", "oai/dall-e-3-image"] }];
    const [model] = expandCopilotReasoningVariants([{ id: "no-think" }], combos);
    expect(model.supportsReasoningEffort).toBeUndefined();
    expect(model.thinking).toBeUndefined();
  });

  it("exposes low/medium/high for Chinese models (GLM, MiniMax, Kimi, Qwen, MiMo)", () => {
    for (const id of [
      "glm/glm-5.2",
      "cbcn/minimax-m3",
      "kimi/kimi-k2.7",
      "oc/qwen3.7-max",
      "oc/mimo-v2.5-pro",
    ]) {
      const [model] = expandCopilotReasoningVariants([{ id }]);
      expect(model.thinking, id).toBe(true);
      expect(model.supportsReasoningEffort, id).toEqual(["low", "medium", "high"]);
      expect(model.reasoningEffortFormat, id).toBe("chat-completions");
    }
  });

  it("resolves a Chinese-model combo to low/medium/high", () => {
    const combos = [{ name: "cn-mix", models: ["glm/glm-5.2", "kimi/kimi-k2.7"] }];
    const [model] = expandCopilotReasoningVariants([{ id: "cn-mix" }], combos);
    expect(model.thinking).toBe(true);
    expect(model.supportsReasoningEffort).toEqual(["low", "medium", "high"]);
  });

  it("treats an unmatched combo name as a plain (unknown) model", () => {
    const [model] = expandCopilotReasoningVariants([{ id: "ghost-combo" }], []);
    expect(model.supportsReasoningEffort).toBeUndefined();
  });
});
