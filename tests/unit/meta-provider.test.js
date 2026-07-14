import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

import REGISTRY from "../../open-sse/providers/registry/index.js";
import { PROVIDERS, PROVIDER_MODELS } from "../../open-sse/providers/index.js";
import { testApiKeyConnection } from "../../src/app/api/providers/[id]/test/testUtils.js";
import { getProviderLogo } from "../../src/shared/constants/providers.js";
import { getFamily } from "../../src/shared/constants/modelFamilies.js";

describe("Meta Model API provider", () => {
  const meta = REGISTRY.find((entry) => entry.id === "meta");

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers official OpenAI-compatible endpoints and API-key auth", () => {
    expect(meta).toBeDefined();
    expect(meta.category).toBe("apikey");
    expect(meta.authModes).toEqual(["apikey"]);
    expect(meta.transport).toMatchObject({
      baseUrl: "https://api.meta.ai/v1/chat/completions",
      validateUrl: "https://api.meta.ai/v1/models",
      thinkingFormat: "openai",
    });
  });

  it("exposes Muse Spark limits and multimodal capabilities", () => {
    expect(PROVIDER_MODELS.meta).toContainEqual(expect.objectContaining({
      id: "muse-spark-1.1",
      contextTokens: 1048576,
      maxOutputTokens: 131072,
      capabilities: expect.arrayContaining(["text", "image", "video", "pdf", "tools", "reasoning"]),
    }));
    expect(meta.passthroughModels).toBe(true);
    expect(meta.modelsFetcher).toEqual({
      url: "https://api.meta.ai/v1/models",
      type: "openai",
    });
  });

  it("builds runtime transport with OpenAI format and bearer fallback", () => {
    expect(PROVIDERS.meta).toMatchObject({
      baseUrl: "https://api.meta.ai/v1/chat/completions",
      format: "openai",
    });
  });

  it("uses Meta branding for provider and Muse model family", () => {
    expect(meta.display.logo).toBe("/providers/meta.svg");
    expect(getProviderLogo("meta")).toBe("/providers/meta.svg");
    expect(getFamily("muse-spark-1.1")).toMatchObject({ key: "muse", logo: "meta.svg" });

    const logoPath = fileURLToPath(new URL("../../public/providers/meta.svg", import.meta.url));
    const logo = readFileSync(logoPath, "utf8");
    expect(logo).toContain("<svg");
    expect(logo).toContain("#0866FF");
  });

  it("keeps registry IDs unique", () => {
    const ids = REGISTRY.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("tests saved Meta connections via the official models endpoint", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: true, status: 200 });

    await expect(testApiKeyConnection({ provider: "meta", apiKey: "meta-test-key" })).resolves.toMatchObject({
      valid: true,
      error: null,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.meta.ai/v1/models",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer meta-test-key" }),
      }),
    );
  });

  it("rejects unauthorized Meta keys with a provider-specific error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: false, status: 401 });

    await expect(testApiKeyConnection({ provider: "meta", apiKey: "bad-key" })).resolves.toMatchObject({
      valid: false,
      error: "Invalid Meta Model API key",
    });
  });
});
