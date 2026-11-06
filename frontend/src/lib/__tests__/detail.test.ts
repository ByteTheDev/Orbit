import { describe, expect, it } from 'vitest'
import { applyEvents, getState, setDetail, setDetailError, setState } from '../store'
import type { OrbitEvent } from '../../types'

function reset(): void {
  setState({ details: {}, detailErrors: {}, agents: {}, agentOrder: [], selectedId: null })
}

describe('setDetail', () => {
  it('drops items that lack the fields the UI keys on', () => {
    reset()
    setDetail('a1', {
      messages: [{ id: 'm1', role: 'user', text: 'hi', streaming: false, at: 1 }, { role: 'user', text: 'no id' } as never],
      tools: [null as never, { id: 't1', name: 'Read', summary: '', input: '', output: '', status: 'ok', at: 2 }],
      activity: [{ id: 1, kind: 'status', text: 'x', at: 1 }, { kind: 'status' } as never],
      issues: [],
      files: [{ path: '', reads: 0, writes: 0, state: 'recent', lastOp: '', lastAt: 0 }, { path: 'a.ts', reads: 1, writes: 0, state: 'reading', lastOp: 'read', lastAt: 1 }],
    })
    const d = getState().details['a1']
    expect(d.messages.map((m) => m.id)).toEqual(['m1'])
    expect(d.tools.map((t) => t.id)).toEqual(['t1'])
    expect(d.activity).toHaveLength(1)
    expect(Object.keys(d.files)).toEqual(['a.ts'])
  })

  it('accepts a null or missing payload as an empty history', () => {
    reset()
    setDetail('a1', null)
    setDetail('a2', undefined)
    expect(getState().details['a1'].messages).toEqual([])
    expect(getState().details['a2'].loaded).toBe(true)
  })

  it('clears a previous load error once the history arrives', () => {
    reset()
    setDetailError('a1', 'network down')
    expect(getState().detailErrors['a1']).toBe('network down')
    setDetail('a1', {})
    expect(getState().detailErrors['a1']).toBeUndefined()
  })
})

describe('setDetailError', () => {
  it('records and clears an error for one agent', () => {
    reset()
    setDetailError('a1', 'boom')
    setDetailError('a2', 'other')
    setDetailError('a1', null)
    expect(getState().detailErrors).toEqual({ a2: 'other' })
  })
})

describe('applyEvents with malformed input', () => {
  it('skips malformed events instead of throwing, and still applies valid ones', () => {
    reset()
    setDetail('a1', { messages: [] })
    const batch = [
      { type: 'message', agentId: 'a1' } as unknown as OrbitEvent, // no message object
      { type: 'tool', agentId: 'a1', tool: null } as unknown as OrbitEvent,
      { type: 'file', agentId: 'a1', file: { path: '' } } as unknown as OrbitEvent,
      { type: 'activity', agentId: 'a1', activity: { id: 9, kind: 'status', text: 'ok', at: 1 } } as OrbitEvent,
    ]
    expect(() => applyEvents(batch)).not.toThrow()
    expect(getState().details['a1'].activity.map((a) => a.id)).toEqual([9])
    expect(getState().details['a1'].tools).toEqual([])
  })
})
