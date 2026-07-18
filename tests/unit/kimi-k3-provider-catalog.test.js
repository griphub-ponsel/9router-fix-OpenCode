import { describe, expect, it } from "vitest";
import { getProviderModels, isValidModel } from "../../open-sse/config/providerModels.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";

describe("Kimi K3 provider catalogs", () => {
  it("exposes the CommandCode Go model id from the upstream account metadata", () => {
    expect(getProviderModels("commandcode")).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "kimi-k3", name: "Kimi K3" }),
    ]));
    expect(isValidModel("commandcode", "kimi-k3")).toBe(true);
  });

  it("exposes both ClinePass-plan and canonical Cline API ids", () => {
    expect(getProviderModels("clinepass")).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "cline-pass/kimi-k3" }),
      expect.objectContaining({ id: "moonshotai/kimi-k3" }),
    ]));
    expect(isValidModel("clinepass", "cline-pass/kimi-k3")).toBe(true);
    expect(isValidModel("clinepass", "moonshotai/kimi-k3")).toBe(true);
  });

  it("advertises Kimi K3 reasoning, vision, PDF, and token limits", () => {
    for (const [provider, model] of [
      ["commandcode", "kimi-k3"],
      ["clinepass", "cline-pass/kimi-k3"],
      ["clinepass", "moonshotai/kimi-k3"],
    ]) {
      expect(getCapabilitiesForModel(provider, model)).toMatchObject({
        vision: true,
        pdf: true,
        reasoning: true,
        thinkingFormat: "kimi",
        contextWindow: 262144,
        maxOutput: 262144,
      });
    }
  });
});