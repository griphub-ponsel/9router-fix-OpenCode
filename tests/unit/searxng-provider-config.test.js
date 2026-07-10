import { afterEach, describe, expect, it, vi } from "vitest";

const originalUrl = process.env.SEARXNG_URL;

async function loadProvider(url) {
  if (url === undefined) delete process.env.SEARXNG_URL;
  else process.env.SEARXNG_URL = url;
  vi.resetModules();
  return (await import("../../open-sse/providers/registry/searxng.js")).default;
}

afterEach(() => {
  if (originalUrl === undefined) delete process.env.SEARXNG_URL;
  else process.env.SEARXNG_URL = originalUrl;
  vi.resetModules();
});

describe("SearXNG provider configuration", () => {
  it("uses configured endpoint and preserves loopback default", async () => {
    expect((await loadProvider("http://searxng:8080/search")).searchConfig.baseUrl)
      .toBe("http://searxng:8080/search");
    expect((await loadProvider(undefined)).searchConfig.baseUrl)
      .toBe("http://localhost:8888/search");
  });
});