import { NextResponse } from "next/server";
import { memoryService } from "@/shared/memory";

// POST - summarize arbitrary text or a session into a memory
export async function POST(request) {
  try {
    if (!memoryService.initialized) {
      await memoryService.initialize();
    }

    const body = await request.json();
    const { text, sessionId, title, scope, userId, workspaceId, projectId, maxLength } = body;

    if (!text && !sessionId) {
      return NextResponse.json({ error: "Provide either 'text' or 'sessionId'" }, { status: 400 });
    }

    let summaryContent = text;

    if (sessionId) {
      // Summarize a full session's observations
      const obs = await memoryService.adapter.listObservationsBySession(sessionId, { limit: 120 });
      const blob = obs.map(o => o.raw_content || '').filter(Boolean).join('\n').slice(0, 12000);
      if (!blob) {
        return NextResponse.json({ error: "No content in session" }, { status: 400 });
      }
      summaryContent = await memoryService.summarizeWithRouter(blob, {
        maxLength: maxLength || 700,
        style: 'concise'
      }) || blob.slice(0, 600);
    } else {
      // Direct text
      summaryContent = await memoryService.summarizeWithRouter(text, {
        maxLength: maxLength || 600,
        style: 'concise'
      }) || text.slice(0, 500);
    }

    const memId = await memoryService.saveMemory({
      type: 'conversation',
      scope: scope || 'session',
      title: title || (sessionId ? `Session ${sessionId.slice(0, 8)} summary` : 'Text summary'),
      content: summaryContent,
      userId,
      workspaceId,
      projectId,
      importanceScore: 0.8
    });

    return NextResponse.json({
      success: true,
      memoryId: memId,
      summary: summaryContent
    });
  } catch (error) {
    console.error("[Memory API] Summarize error:", error);
    return NextResponse.json({ error: "Summarization failed", details: error.message }, { status: 500 });
  }
}
