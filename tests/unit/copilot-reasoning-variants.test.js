import { describe, expect, it } from "vitest";

import { expandCopilotReasoningVariants } from "../../src/shared/utils/copilotReasoningVariants.js";

describe("expandCopilotReasoningVariants", () => {
  it("exposes xhigh/max for opus 4.7 selected by model id", () => {
    const [model] = expandCopilotReasoningVariants([{ id: "cc/claude-opus-4-7" }]);
    expect(model.thinking).toBe(true);
    expect(model.supportsReasoningEffort).toEqual(["low", "medium", "high", "xhigh", "max"]);
  });

  it("falls back to low/medium/high for an unknown model", () => {
    const [model] = expandCopilotReasoningVariants([{ id: "cc/claude-haiku-4-5" }]);
    expect(model.supportsReasoningEffort).toEqual(["low", "medium", "high"]);
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
    const combos = [{ name: "no-think", models: ["glm/glm-5.2", "kimi/kimi-k2.7"] }];
    const [model] = expandCopilotReasoningVariants([{ id: "no-think" }], combos);
    expect(model.supportsReasoningEffort).toBeUndefined();
    expect(model.thinking).toBeUndefined();
  });

  it("treats an unmatched combo name as a plain (unknown) model", () => {
    const [model] = expandCopilotReasoningVariants([{ id: "ghost-combo" }], []);
    expect(model.supportsReasoningEffort).toBeUndefined();
  });
});
