import { NextResponse } from "next/server";
import { memoryService } from "@/shared/memory";

// POST - create episodic summary for a session
export async function POST(request) {
  try {
    if (!memoryService.initialized) {
      await memoryService.initialize();
    }

    const body = await request.json();
    const { sessionId, scope, userId, workspaceId, projectId, title, importanceScore } = body;

    if (!sessionId) {
      return NextResponse.json({ error: "sessionId required" }, { status: 400 });
    }

    const memId = await memoryService.createEpisodicSummary(sessionId, {
      scope: scope || 'session',
      userId,
      workspaceId,
      projectId,
      title,
      importanceScore
    });

    if (!memId) {
      return NextResponse.json({ error: "No observations to summarize or summary creation failed" }, { status: 400 });
    }

    return NextResponse.json({ success: true, memoryId: memId });
  } catch (error) {
    console.error("[Memory API] Episodic error:", error);
    return NextResponse.json({ error: "Failed to create episodic summary", details: error.message }, { status: 500 });
  }
}
