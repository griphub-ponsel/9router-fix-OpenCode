import { describe, expect, it } from "vitest";
import { getOAuthRedirectUri } from "@/shared/utils/oauthRedirectUri.js";

describe("getOAuthRedirectUri", () => {
  it("uses the dashboard LAN origin for generic authorization-code providers", () => {
    expect(getOAuthRedirectUri("github", "http://192.168.18.149:20128")).toBe(
      "http://192.168.18.149:20128/callback"
    );
  });

  it("preserves fixed loopback callbacks required by Codex and xAI", () => {
    const lanOrigin = "http://192.168.18.149:20128";

    expect(getOAuthRedirectUri("codex", lanOrigin)).toBe("http://localhost:1455/auth/callback");
    expect(getOAuthRedirectUri("xai", lanOrigin)).toBe("http://127.0.0.1:56121/callback");
    expect(getOAuthRedirectUri("xai-oauth", lanOrigin)).toBe("http://127.0.0.1:56121/callback");
  });

  it("keeps Antigravity on a Google-approved loopback callback when opened over LAN", () => {
    expect(getOAuthRedirectUri("antigravity", "http://192.168.18.149:20128")).toBe(
      "http://localhost:20128/callback"
    );
  });
});
