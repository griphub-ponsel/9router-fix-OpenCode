export function getOAuthRedirectUri(provider, origin) {
  if (provider === "codex") return "http://localhost:1455/auth/callback";
  if (provider === "xai" || provider === "xai-oauth") return "http://127.0.0.1:56121/callback";
  if (provider === "antigravity") {
    const { port, protocol } = new URL(origin);
    const appPort = port || (protocol === "https:" ? "443" : "80");
    return `http://localhost:${appPort}/callback`;
  }
  return `${origin}/callback`;
}
