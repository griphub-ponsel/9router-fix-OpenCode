import { describe, expect, it } from "vitest";

import { generateAuthData } from "@/lib/oauth/providers";

describe("Antigravity OAuth authorization URL", () => {
  it.each([
    "http://localhost:20128/callback",
    "http://192.168.18.149:20128/callback",
  ])("does not send non-standard device parameters for %s", async (redirectUri) => {
    const authUrl = new URL((await generateAuthData("antigravity", redirectUri)).authUrl);

    expect(authUrl.searchParams.has("device_id")).toBe(false);
    expect(authUrl.searchParams.has("device_name")).toBe(false);
  });
});
