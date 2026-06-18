import { NextResponse } from "next/server";
import { memoryService } from "@/shared/memory";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const format = searchParams.get("format") || "json";
    
    // Initialize memory service if not already
    if (!memoryService.initialized) {
      await memoryService.initialize();
    }
    
    // Get all memories
    const memories = await memoryService.adapter.listMemories({}, { limit: 1000 });
    const observations = await memoryService.adapter.all('SELECT * FROM observations', []);
    
    let content, mimeType, fileName;
    
    switch (format) {
      case "csv":
        // Generate CSV
        const headers = ["id", "type", "scope", "title", "content", "created_at", "importance_score"];
        const rows = memories.map(m => 
          [m.id, m.type, m.scope, `"${(m.title || "").replace(/"/g, '""')}"`, 
           `"${(m.content || "").replace(/"/g, '""')}"`, m.created_at, m.importance_score].join(",")
        );
        
        content = [headers.join(","), ...rows].join("\n");
        mimeType = "text/csv";
        fileName = `9router-memory-${new Date().toISOString().split("T")[0]}.csv`;
        break;
        
      case "markdown":
        // Generate Markdown
        const mdParts = [
          "# 9Router Memory Export\n",
          `**Exported on:** ${new Date().toLocaleString()}\n\n`
        ];
        
        for (const memory of memories) {
          mdParts.push(`## ${memory.title}\n`);
          mdParts.push(`- **Type:** ${memory.type}\n`);
          mdParts.push(`- **Scope:** ${memory.scope}\n`);
          mdParts.push(`- **Importance:** ${(memory.importance_score * 100).toFixed(0)}%\n`);
          mdParts.push(`- **Created:** ${new Date(memory.created_at).toLocaleString()}\n`);
          mdParts.push(`\n### Content\n\`\`\`\n${memory.content}\n\`\`\`\n\n---\n\n`);
        }
        
        content = mdParts.join("");
        mimeType = "text/markdown";
        fileName = `9router-memory-${new Date().toISOString().split("T")[0]}.md`;
        break;
        
      case "json":
      default:
        content = JSON.stringify({
          exportedAt: new Date().toISOString(),
          totalMemories: memories.length,
          data: memories
        }, null, 2);
        mimeType = "application/json";
        fileName = `9router-memory-${new Date().toISOString().split("T")[0]}.json`;
        break;
    }
    
    return new NextResponse(content, {
      headers: {
        "Content-Type": mimeType,
        "Content-Disposition": `attachment; filename="${fileName}"`
      }
    });
  } catch (error) {
    console.error("[Memory API] Export error:", error);
    return NextResponse.json(
      { error: "Failed to export memory data", details: error.message },
      { status: 500 }
    );
  }
}
