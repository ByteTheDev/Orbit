import { describe, expect, it } from 'vitest'
import { toolKind } from '../toolKind'

describe('toolKind', () => {
  it('maps Claude Code tool names to their kind', () => {
    expect(toolKind('Read')).toBe('read')
    expect(toolKind('Write')).toBe('write')
    expect(toolKind('Edit')).toBe('edit')
    expect(toolKind('MultiEdit')).toBe('edit')
    expect(toolKind('Bash')).toBe('shell')
    expect(toolKind('PowerShell')).toBe('shell')
    expect(toolKind('Grep')).toBe('search')
    expect(toolKind('Glob')).toBe('search')
    expect(toolKind('WebFetch')).toBe('web')
    expect(toolKind('Task')).toBe('agent')
  })

  it('maps Codex tool names to their kind', () => {
    expect(toolKind('Shell')).toBe('shell')
    expect(toolKind('apply_patch')).toBe('edit')
    expect(toolKind('WebSearch')).toBe('web')
  })

  it('treats dotted names as MCP tools', () => {
    expect(toolKind('github.create_issue')).toBe('mcp')
  })

  it('treats Claude Code’s mcp__server__tool names as MCP tools', () => {
    expect(toolKind('mcp__orbit-browser__browse_page')).toBe('mcp')
  })

  it('falls back to other for unknown or empty names', () => {
    expect(toolKind('SomethingNew')).toBe('other')
    expect(toolKind('')).toBe('other')
    expect(toolKind('   ')).toBe('other')
  })
})
