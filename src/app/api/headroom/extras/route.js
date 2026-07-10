import { NextResponse } from "next/server";
import {
  findPython310,
  getInstalledHeadroomExtras,
  HEADROOM_COMPRESSION_EXTRAS,
} from "@/lib/headroom/detect";
import {
  getInstallLogTail,
  installHeadroomExtras,
  uninstallHeadroomExtras,
} from "@/lib/headroom/process";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    if (new URL(request.url).searchParams.get("log") === "1") {
      return NextResponse.json({ log: getInstallLogTail() });
    }
    return NextResponse.json({
      available: HEADROOM_COMPRESSION_EXTRAS,
      ...getInstalledHeadroomExtras(findPython310()),
    });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    return NextResponse.json(await installHeadroomExtras(body.extras));
  } catch (error) {
    const status = ["NOT_INSTALLED", "NO_PYTHON"].includes(error.code) ? 400 : 500;
    return NextResponse.json({ error: error.message, code: error.code || null }, { status });
  }
}

export async function DELETE(request) {
  try {
    const body = await request.json().catch(() => ({}));
    return NextResponse.json(await uninstallHeadroomExtras(body.extras));
  } catch (error) {
    const status = ["NO_PYTHON", "INVALID_EXTRAS"].includes(error.code) ? 400 : 500;
    return NextResponse.json({ error: error.message, code: error.code || null }, { status });
  }
}