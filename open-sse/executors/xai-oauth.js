import { DefaultExecutor } from "./default.js";
import { PROVIDERS } from "../config/providers.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";

/**
 * xAI Grok OAuth executor (SuperGrok subscription).
 * Inherits OpenAI-compatible request shape from DefaultExecutor and overrides
 * refreshCredentials() to talk to auth.x.ai with PKCE public-client refresh.
 */
export class XaiOauthExecutor extends DefaultExecutor {
  constructor() {
    super("xai-oauth");
  }

  transformRequest(model, body, stream, credentials) {
    const transformed = { ...body, model };

    if (transformed.max_tokens !== undefined && transformed.max_output_tokens === undefined) {
      transformed.max_output_tokens = transformed.max_tokens;
    }
    delete transformed.max_tokens;
    delete transformed.max_completion_tokens;

    if (typeof transformed.instructions === "string" && transformed.instructions.trim() === "") {
      delete transformed.instructions;
    }

    return transformed;
  }

  async refreshCredentials(credentials, log, proxyOptions = null) {
    if (!credentials?.refreshToken) return null;
    const config = PROVIDERS["xai-oauth"];
    if (!config?.tokenUrl || !config?.clientId) return null;

    try {
      const response = await proxyAwareFetch(
        config.tokenUrl,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
          },
          body: new URLSearchParams({
            grant_type: "refresh_token",
            client_id: config.clientId,
            refresh_token: credentials.refreshToken,
          }),
        },
        proxyOptions,
      );

      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        log?.warn?.(
          "TOKEN",
          `xai-oauth refresh failed: HTTP ${response.status} ${errorText.slice(0, 200)}`,
        );
        return null;
      }

      const tokens = await response.json();
      log?.info?.("TOKEN", "xai-oauth refreshed");
      return {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || credentials.refreshToken,
        expiresIn: tokens.expires_in,
      };
    } catch (error) {
      log?.error?.("TOKEN", `xai-oauth refresh error: ${error.message}`);
      return null;
    }
  }
}

export default XaiOauthExecutor;
