import { describe, expect, it } from "vitest";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";

describe("getCapabilitiesForModel", () => {
  it("reports Kiro Claude Opus 4.8 as a 1M context model", () => {
    expect(getCapabilitiesForModel("kiro", "claude-opus-4.8").contextWindow).toBe(1000000);
    expect(getCapabilitiesForModel("kiro", "anthropic/claude-opus-4.8").contextWindow).toBe(1000000);
    expect(getCapabilitiesForModel("kiro", "claude-opus-4-8").contextWindow).toBe(1000000);
    expect(getCapabilitiesForModel("kiro", "claude-opus-4.8-thinking").contextWindow).toBe(1000000);
    expect(getCapabilitiesForModel("kiro", "claude-opus-4-8-thinking").contextWindow).toBe(1000000);
  });

  it("marks qwen as text-only on opencode-go (gateway rejects images) but vision elsewhere", () => {
    // opencode-go → Vercel gateway → alibaba rejects image parts with
    // "Unexpected item type in content." even though qwen3.7-max is natively vision-capable
    expect(getCapabilitiesForModel("opencode-go", "qwen3.7-max").vision).toBe(false);
    expect(getCapabilitiesForModel("opencode-go", "qwen-3.7-max").vision).toBe(false);
    expect(getCapabilitiesForModel("opencode-go", "qwen3.7-plus").vision).toBe(false);
    // canonical entry still wins for other providers
    expect(getCapabilitiesForModel("qwen", "qwen3.7-max").vision).toBe(true);
  });
});
