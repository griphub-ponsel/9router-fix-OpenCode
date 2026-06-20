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
    
    // Search mode: 'keyword' | 'hybrid' | 'semantic'
    const mode = (searchParams.get("mode") || "hybrid").toLowerCase();
    
    // Build filters
    const filters = {};
    if (workspaceId) filters.workspaceId = workspaceId;
    if (scope) filters.scope = scope;
    
    let memories = [];
    let searchType = mode;

    if (mode === "semantic") {
      // Pure semantic search (requires embedding for the query)
      memories = await memoryService.semanticSearchMemories(query, {
        ...filters,
        maxResults: limit
      });
      searchType = "semantic";
    } else if (mode === "keyword") {
      // Pure keyword (BM25-style)
      const results = await memoryService.adapter.keywordSearch(query, filters, { limit });
      memories = results.map(r => r.memory);
      searchType = "keyword";
    } else {
      // Hybrid (default) — keyword + vector with RRF
      memories = await memoryService.searchMemories(query, {
        ...filters,
        maxResults: limit,
        hybrid: true
      });
      searchType = "hybrid";
    }
    
    return NextResponse.json({
      memories,
      total: memories.length,
      hasMore: memories.length === limit,
      mode: searchType
    });
  } catch (error) {
    console.error("[Memory API] Search error:", error);
    return NextResponse.json(
      { error: "Failed to search memories", details: error.message },
      { status: 500 }
    );
  }
}
