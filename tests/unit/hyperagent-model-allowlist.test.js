import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/lib/db/index.js", () => ({}));

describe("Hyperagent model catalog", () => {
  it("exposes concrete selectable model IDs without latest aliases", async () => {
    const fs = await import("node:fs/promises");
    const registry = await fs.readFile(new URL("../../open-sse/providers/registry/hyperagent.js", import.meta.url), "utf8");
    const allowlist = await fs.readFile(new URL("../../src/app/api/v1/models/route.js", import.meta.url), "utf8");
    for (const id of [
      "claude-opus-4-8",
      "claude-sonnet-5",
      "openai/gpt-5.6-sol",
      "moonshotai/kimi-k2.6",
      "zai/glm-5.2-fast",
      "xai/grok-4.5",
    ]) {
      expect(registry).toContain(`id: "${id}"`);
      expect(allowlist).toContain(`"ha/${id}"`);
    }
    expect(registry).not.toMatch(/id: "[^"]*-latest"/);
  });

  it("renders web-cookie providers in the dashboard provider list", async () => {
    const source = await import("node:fs/promises").then((fs) =>
      fs.readFile(new URL("../../src/app/(dashboard)/dashboard/providers/page.js", import.meta.url), "utf8")
    );
    expect(source).toContain("const webCookieEntries");
    expect(source).toContain("Web Cookie Providers");
    expect(source).toContain('getProviderStats(key, "cookie")');
  });
});
