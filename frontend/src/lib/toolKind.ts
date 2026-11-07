/**
 * Groups tool names from every provider (Claude Code, Codex, MCP servers) into a small set of
 * kinds, so the chat can show one recognisable glyph per kind. Pure: no React, no Wails.
 */
export type ToolKind = 'read' | 'write' | 'edit' | 'shell' | 'search' | 'web' | 'agent' | 'mcp' | 'other'

const KIND_BY_NAME: Record<string, ToolKind> = {
  Read: 'read',
  NotebookRead: 'read',
  Write: 'write',
  NotebookEdit: 'edit',
  Edit: 'edit',
  MultiEdit: 'edit',
  apply_patch: 'edit',
  Bash: 'shell',
  PowerShell: 'shell',
  Shell: 'shell',
  Grep: 'search',
  Glob: 'search',
  LS: 'search',
  WebSearch: 'web',
  WebFetch: 'web',
  Task: 'agent',
  Agent: 'agent',
}

export function toolKind(name: string): ToolKind {
  const n = (name || '').trim()
  if (!n) return 'other'
  const known = KIND_BY_NAME[n]
  if (known) return known
  // Codex MCP calls are named "server.tool"; a dot is the only reliable marker.
  if (n.includes('.')) return 'mcp'
  // Claude Code names MCP calls "mcp__server__tool".
  if (n.startsWith('mcp__')) return 'mcp'
  return 'other'
}
