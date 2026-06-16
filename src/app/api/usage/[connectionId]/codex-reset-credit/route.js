// Ensure proxyFetch is loaded to patch globalThis.fetch
import "open-sse/index.js";

import { randomUUID } from "node:crypto";
import { getProviderConnectionById } from "@/lib/localDb";
import { resolveConnectionProxyConfig } from "@/lib/network/connectionProxy";
import { consumeCodexRateLimitResetCredit } from "open-sse/services/usage.js";

export async function POST(request, { params }) {
  try {
    const { connectionId } = await params;
    const connection = await getProviderConnectionById(connectionId);

    if (!connection) {
      return Response.json({ error: "Connection not found" }, { status: 404 });
    }
    if (connection.provider !== "codex" || connection.authType !== "oauth") {
      return Response.json({ error: "Reset credits are only available for Codex OAuth connections" }, { status: 400 });
    }

    const proxyConfig = await resolveConnectionProxyConfig(connection.providerSpecificData);
    const proxyOptions = {
      connectionProxyEnabled: proxyConfig.connectionProxyEnabled === true,
      connectionProxyUrl: proxyConfig.connectionProxyUrl || "",
      connectionNoProxy: proxyConfig.connectionNoProxy || "",
      vercelRelayUrl: proxyConfig.vercelRelayUrl || "",
      strictProxy: false,
    };

    const result = await consumeCodexRateLimitResetCredit(
      connection.accessToken,
      randomUUID(),
      proxyOptions,
    );

    const status = result.ok || result.noCredit ? 200 : 502;
    return Response.json(result, { status });
  } catch (error) {
    return Response.json({ error: error.message || "Failed to reset Codex quota" }, { status: 500 });
  }
}
