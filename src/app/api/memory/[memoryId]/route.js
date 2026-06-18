import { NextResponse } from "next/server";
import { memoryService } from "@/shared/memory";

export async function GET(request, { params }) {
  try {
    const { memoryId } = await params;
    
    if (!memoryId) {
      return NextResponse.json(
        { error: "Memory ID required" },
        { status: 400 }
      );
    }
    
    // Initialize memory service if not already
    if (!memoryService.initialized) {
      await memoryService.initialize();
    }
    
    const memory = await memoryService.getMemory(memoryId);
    
    if (!memory) {
      return NextResponse.json(
        { error: "Memory not found" },
        { status: 404 }
      );
    }
    
    return NextResponse.json(memory);
  } catch (error) {
    console.error("[Memory API] Get memory error:", error);
    return NextResponse.json(
      { error: "Failed to get memory", details: error.message },
      { status: 500 }
    );
  }
}

export async function DELETE(request, { params }) {
  try {
    const { memoryId } = await params;
    
    if (!memoryId) {
      return NextResponse.json(
        { error: "Memory ID required" },
        { status: 400 }
      );
    }
    
    // Initialize memory service if not already
    if (!memoryService.initialized) {
      await memoryService.initialize();
    }
    
    // Delete memory (requires user ID for permission check)
    await memoryService.deleteMemory(memoryId, "api-user");
    
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[Memory API] Delete memory error:", error);
    return NextResponse.json(
      { error: "Failed to delete memory", details: error.message },
      { status: 500 }
    );
  }
}
