import { NextResponse } from "next/server";
import { memoryService } from "@/shared/memory";

export async function GET() {
  try {
    // Initialize memory service if not already
    if (!memoryService.initialized) {
      await memoryService.initialize();
    }
    
    const stats = await memoryService.getStats();
    
    return NextResponse.json(stats);
  } catch (error) {
    console.error("[Memory API] Stats error:", error);
    return NextResponse.json(
      { error: "Failed to get statistics", details: error.message },
      { status: 500 }
    );
  }
}
