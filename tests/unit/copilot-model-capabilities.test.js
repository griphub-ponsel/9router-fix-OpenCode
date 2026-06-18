import { describe, expect, it } from "vitest";

import { supportsCopilotVision } from "../../src/shared/utils/copilotModelCapabilities.js";

describe("Copilot model capabilities", () => {
  it("keeps Grok Composer selectable in image-tainted VS Code sessions", () => {
    expect(supportsCopilotVision("xog/grok-composer-2.5-fast")).toBe(true);
  });

  it("does not advertise obvious text-only coding models as vision models", () => {
    expect(supportsCopilotVision("ocg/deepseek-v4-pro")).toBe(false);
  });
});