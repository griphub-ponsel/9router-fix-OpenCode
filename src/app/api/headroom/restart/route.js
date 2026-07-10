import { NextResponse } from "next/server";
import { getSettings } from "@/lib/localDb";
import { restartHeadroomProxy } from "@/lib/headroom/process";
import { DEFAULT_HEADROOM_URL, isLoopbackHeadroomUrl } from "@/lib/headroom/detect";

export const dynamic = "force-dynamic";

function parsePortFromUrl(url) {
  try {
    const port = Number.parseInt(new URL(url).port, 10);
    return port > 0 && port < 65536 ? port : null;
  } catch { return null; }
}

export async function POST() {
  try {
    const settings = await getSettings();
    const url = settings.headroomUrl || DEFAULT_HEADROOM_URL;
    if (!isLoopbackHeadroomUrl(url)) {
      return NextResponse.json(
        { error: "External Headroom proxies must be restarted outside 9Router", code: "EXTERNAL_PROXY" },
        { status: 400 }
      );
    }
    const result = await restartHeadroomProxy({
      port: parsePortFromUrl(url) || 8787,
      codeAware: settings.headroomCodeAware === true,
      kompress: settings.headroomKompress !== false,
    });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    const status = error.code === "NOT_INSTALLED" ? 400 : 500;
    return NextResponse.json({ error: error.message, code: error.code || null }, { status });
  }
}