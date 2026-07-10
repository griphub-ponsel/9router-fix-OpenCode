import { describe, expect, it } from "vitest";

import {
  getCopilotContextSizeOptions,
  getCopilotContextTokens,
  getCopilotModelLimits,
} from "../../src/shared/utils/copilotModelLimits.js";

describe("Copilot model limits", () => {
  it.each(["luna", "sol", "terra"])("advertises GPT 5.6 %s with 1M context", (variant) => {
    const id = `cx/gpt-5.6-${variant}`;

    expect(getCopilotContextTokens(id)).toBe(1_000_000);
    expect(getCopilotModelLimits(id)).toEqual({
      maxInputTokens: 872_000,
      maxOutputTokens: 128_000,
    });
    expect(getCopilotModelLimits(id, 256_000)).toEqual({
      maxInputTokens: 872_000,
      maxOutputTokens: 128_000,
    });
    expect(getCopilotContextSizeOptions(id)).toContainEqual({ value: 1_000_000, label: "1M" });
  });
});