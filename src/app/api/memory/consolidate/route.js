import { NextResponse } from "next/server";
import { memoryService } from "@/shared/memory";

// POST - trigger consolidation (merge duplicates + decay + optional episodic summaries)
export async function POST(request) {
  try {
    if (!memoryService.initialized) {
      await memoryService.initialize();
    }

    const body = await request.json().catch(() => ({}));
    const result = await memoryService.consolidate({
      createEpisodicSummaries: body.createEpisodicSummaries !== false
    });

    return NextResponse.json({
      success: true,
      ...result
    });
  } catch (error) {
    console.error("[Memory API] Consolidate error:", error);
    return NextResponse.json({ error: "Consolidation failed", details: error.message }, { status: 500 });
  }
}
