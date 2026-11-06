import { describe, expect, it } from 'vitest'
import { applyEvents, applySnapshot, getState, setDetail, setState } from '../store'
import type { AgentSummary, OrbitEvent, ProjectSummary } from '../../types'

const project: ProjectSummary = {
  id: 'p1', name: 'App', repoPath: 'C:/app', createdAt: 1, agentCount: 0, runningCount: 0, conflicts: [],
}

function agent(overrides: Partial<AgentSummary> = {}): AgentSummary {
  return {
    id: 'a1', projectId: 'p1', name: 'Alpha', provider: 'claude', providerName: 'Claude Code',
    model: '', task: '', permissionMode: '', status: 'idle', statusDetail: '', sessionId: '', running: false,
    createdAt: 2, updatedAt: 2, runStartedAt: 0, turns: 0, toolCalls: 0,
    usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, costUsd: 0 }, lastError: '',
    fileCount: 0, writeCount: 0, issueCount: 0, recentFiles: [],
    capabilities: { stop: true, resume: true, send: true, cost: true, streaming: true, permissionModes: [] },
    ...overrides,
  }
}

function reset() {
  setState({ projects: {}, projectOrder: [], agents: {}, agentOrder: [], details: {}, selectedId: null, activeProjectId: null })
  applySnapshot({ projects: [], agents: [], providers: [], statePath: '', storageError: '', version: '' })
}

describe('applyEvents', () => {
  it('adds projects and agents in creation order', () => {
    reset()
    applyEvents([
      { type: 'project', id: 'p1', project },
      { type: 'agent', id: 'a2', agent: agent({ id: 'a2', createdAt: 9 }) },
      { type: 'agent', id: 'a1', agent: agent() },
    ] as OrbitEvent[])
    expect(getState().agentOrder).toEqual(['a1', 'a2'])
    expect(getState().activeProjectId).toBe('p1')
  })

  it('appends streamed text only to a loaded history', () => {
    reset()
    applyEvents([{ type: 'agent', id: 'a1', agent: agent() }] as OrbitEvent[])
    const message = { id: 'm1', role: 'assistant' as const, text: 'He', streaming: true, at: 1 }

    // Before the history is loaded the deltas are ignored rather than half-applied.
    applyEvents([
      { type: 'message', agentId: 'a1', message },
      { type: 'delta', agentId: 'a1', messageId: 'm1', text: 'llo' },
    ] as OrbitEvent[])
    expect(getState().details['a1']).toBeUndefined()

    setDetail('a1', { messages: [message], tools: [], activity: [], issues: [], files: [] })
    applyEvents([{ type: 'delta', agentId: 'a1', messageId: 'm1', text: 'llo' }] as OrbitEvent[])
    expect(getState().details['a1'].messages[0].text).toBe('Hello')
  })

  it('treats null or missing history collections as empty', () => {
    reset()
    applyEvents([{ type: 'agent', id: 'a1', agent: agent() }] as OrbitEvent[])
    // The Go side used to send null for empty collections; the store must survive that.
    setDetail('a1', { messages: null, tools: null, activity: null, issues: null, files: null })
    const d = getState().details['a1']
    expect(d.loaded).toBe(true)
    expect(d.messages).toEqual([])
    expect(d.tools).toEqual([])
    expect(d.activity).toEqual([])
    expect(d.issues).toEqual([])
    expect(d.files).toEqual({})

    setDetail('a1', {})
    expect(getState().details['a1'].files).toEqual({})
  })

  it('keeps the same agent map when only history changes', () => {
    reset()
    applyEvents([{ type: 'agent', id: 'a1', agent: agent() }] as OrbitEvent[])
    setDetail('a1', { messages: [], tools: [], activity: [], issues: [], files: [] })
    const before = getState().agents
    applyEvents([{ type: 'activity', agentId: 'a1', activity: { id: 1, kind: 'system', text: 'x', at: 1 } }] as OrbitEvent[])
    expect(getState().agents).toBe(before)
  })

  it('clears the selection when its agent is removed', () => {
    reset()
    applyEvents([{ type: 'agent', id: 'a1', agent: agent() }] as OrbitEvent[])
    setState({ selectedId: 'a1' })
    applyEvents([{ type: 'agentRemoved', id: 'a1' }] as OrbitEvent[])
    expect(getState().selectedId).toBeNull()
    expect(getState().agentOrder).toEqual([])
  })
})
