// Single source of truth for parsing MCP tool names of the shape
// `mcp__<server>__<tool>` (Codex surfaces MCP tools under this same name). The
// server segment is everything up to the FIRST `__`
// after the `mcp__` prefix; the tool segment is the remainder. Both segments may
// themselves contain single underscores (e.g. `mcp__notion_internal__create_page`)
// and the tool segment may contain further `__`. Both segments must be non-empty.
//
// parser.ts, config.ts, and the classifier registry all use this so their notion
// of "valid MCP tool name" cannot drift apart.

export type McpNameParts = { server: string; tool: string };

export function splitMcpToolName(toolName: string): McpNameParts | null {
  if (!toolName.startsWith("mcp__")) return null;
  const rest = toolName.slice("mcp__".length);
  const idx = rest.indexOf("__");
  if (idx <= 0) return null; // no separator, or empty server segment
  const server = rest.slice(0, idx);
  const tool = rest.slice(idx + 2);
  if (tool.length === 0) return null; // empty tool segment
  return { server, tool };
}

export function isMcpToolName(toolName: string): boolean {
  return splitMcpToolName(toolName) !== null;
}
