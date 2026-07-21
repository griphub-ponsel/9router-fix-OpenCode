/**
 * Per-tool DNS hosts — written to hosts file as 127.0.0.1 when MITM DNS is enabled.
 * Data lives in mitmToolHosts.json so both Vite ESM and Node CJS can load it cleanly.
 */
import hosts from "./mitmToolHosts.json";

export const TOOL_HOSTS = hosts;
export default hosts;
