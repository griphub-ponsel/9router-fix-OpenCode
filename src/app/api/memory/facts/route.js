import { NextResponse } from "next/server";
import { memoryService } from "@/shared/memory";

// GET - list facts
export async function GET(request) {
  try {
    if (!memoryService.initialized) {
      await memoryService.initialize();
    }

    const { searchParams } = new URL(request.url);
    const category = searchParams.get("category") || undefined;
    const sessionId = searchParams.get("session_id") || undefined;
    const limit = parseInt(searchParams.get("limit") || "100");

    const facts = await memoryService.adapter.listFacts({ category, sessionId }, { limit });

    return NextResponse.json({ facts, total: facts.length });
  } catch (error) {
    console.error("[Memory API] Facts GET error:", error);
    return NextResponse.json({ error: "Failed to get facts", details: error.message }, { status: 500 });
  }
}

// POST - extract facts from text or session and store them
export async function POST(request) {
  try {
    if (!memoryService.initialized) {
      await memoryService.initialize();
    }

    const body = await request.json();
    const { text, sessionId, useLLM, category } = body;

    let sourceText = text;
    let obs = [];

    if (sessionId) {
      obs = await memoryService.adapter.listObservationsBySession(sessionId, { limit: 80 });
      sourceText = obs.map(o => o.raw_content || '').filter(Boolean).join('\n');
    }

    if (!sourceText) {
      return NextResponse.json({ error: "No text or session content" }, { status: 400 });
    }

    const facts = await memoryService.extractFactsFromObservations(obs.length ? obs : [{ raw_content: sourceText }], {
      useLLM: !!useLLM
    });

    const savedHashes = [];
    for (const f of facts) {
      const hash = await memoryService.adapter.saveFact({
        factText: f.value || f,
        category: category || f.type || 'extracted',
        confidence: 0.75,
        sourceSessionId: sessionId || null
      });
      savedHashes.push(hash);
    }

    return NextResponse.json({
      success: true,
      extracted: facts.length,
      saved: savedHashes.length,
      facts
    });
  } catch (error) {
    console.error("[Memory API] Facts POST error:", error);
    return NextResponse.json({ error: "Fact extraction failed", details: error.message }, { status: 500 });
  }
}
