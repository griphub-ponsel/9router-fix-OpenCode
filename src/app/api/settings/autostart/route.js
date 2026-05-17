/**
 * GET  /api/settings/autostart  - return { supported, enabled, platform }
 * POST /api/settings/autostart  - body: { enabled: boolean }
 *
 * The autostart entry is a per-user OS resource (LaunchAgent on macOS, a
 * Startup .vbs on Windows, a .desktop file on Linux), not a value in the
 * 9router db. We expose status via a dedicated endpoint instead of folding it
 * into /api/settings so the OS-level read happens lazily. `getSettings()` is
 * called from many request paths and shouldn't trigger a `launchctl list`
 * subprocess each time.
 */
import { NextResponse } from "next/server";
import {
  getAutoStartStatus,
  enableAutoStart,
  disableAutoStart,
} from "@/lib/system/autostart";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET() {
  try {
    const status = getAutoStartStatus();
    return NextResponse.json(status, { headers: NO_STORE });
  } catch (error) {
    return NextResponse.json(
      { error: error?.message || "Failed to read autostart status" },
      { status: 500 }
    );
  }
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const enabled = body?.enabled === true;

    const result = enabled ? enableAutoStart() : disableAutoStart();

    if (!result?.success) {
      return NextResponse.json(
        { error: result?.error || "Failed to update autostart" },
        { status: 400, headers: NO_STORE }
      );
    }

    // Re-read status so the UI gets the authoritative state. On macOS the
    // launchctl call may have failed silently and the plist still exists, so
    // we trust isAutoStartEnabled() rather than echoing `enabled` back.
    const status = getAutoStartStatus();
    return NextResponse.json(status, { headers: NO_STORE });
  } catch (error) {
    return NextResponse.json(
      { error: error?.message || "Failed to update autostart" },
      { status: 500 }
    );
  }
}
