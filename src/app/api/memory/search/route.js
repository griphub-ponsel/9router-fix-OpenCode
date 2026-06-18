import { NextResponse } from "next/server";
import { memoryService } from "@/shared/memory";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    
    // Initialize memory service if not already
    if (!memoryService.initialized) {
      await memoryService.initialize();
    }
    
    const query = searchParams.get("q") || "";
    const limit = parseInt(searchParams.get("limit")) || 50;
    const workspaceId = searchParams.get("workspace_id");
    const scope = searchParams.get("scope");
    
    // Build filters
    const filters = {};
    if (workspaceId) filters.workspaceId = workspaceId;
    if (scope) filters.scope = scope;
    
    // Search memories
    const results = await memoryService.adapter.keywordSearch(
      query, 
      filters, 
      { limit }
    );
    
    return NextResponse.json({
      memories: results.map(r => r.memory),
      total: results.length,
      hasMore: results.length === limit
    });
  } catch (error) {
    console.error("[Memory API] Search error:", error);
    return NextResponse.json(
      { error: "Failed to search memories", details: error.message },
      { status: 500 }
    );
  }
}
