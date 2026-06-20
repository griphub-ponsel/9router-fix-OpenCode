import { NextResponse } from "next/server";
import { memoryService } from "@/shared/memory";

// GET - list pinned memories (Memory Slots)
export async function GET(request) {
  try {
    if (!memoryService.initialized) {
      await memoryService.initialize();
    }

    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get("limit") || "30");
    const scope = searchParams.get("scope") || undefined;
    const userId = searchParams.get("user_id") || undefined;
    const workspaceId = searchParams.get("workspace_id") || undefined;

    const pinned = await memoryService.getPinnedMemories({
      scope,
      userId,
      workspaceId
    }, limit);

    return NextResponse.json({
      pinned,
      count: pinned.length
    });
  } catch (error) {
    console.error("[Memory API] Pinned error:", error);
    return NextResponse.json({ error: "Failed to get pinned memories", details: error.message }, { status: 500 });
  }
}

// POST - pin or unpin a memory
export async function POST(request) {
  try {
    if (!memoryService.initialized) {
      await memoryService.initialize();
    }

    const body = await request.json();
    const { memoryId, action } = body; // action = "pin" | "unpin"

    if (!memoryId) {
      return NextResponse.json({ error: "memoryId required" }, { status: 400 });
    }

    if (action === "pin") {
      await memoryService.pinMemory(memoryId, body.userId || "api-user");
      return NextResponse.json({ success: true, action: "pinned" });
    } else if (action === "unpin") {
      await memoryService.unpinMemory(memoryId, body.userId || "api-user");
      return NextResponse.json({ success: true, action: "unpinned" });
    } else {
      return NextResponse.json({ error: "action must be 'pin' or 'unpin'" }, { status: 400 });
    }
  } catch (error) {
    console.error("[Memory API] Pin/Unpin error:", error);
    return NextResponse.json({ error: "Failed to update pin state", details: error.message }, { status: 500 });
  }
}
