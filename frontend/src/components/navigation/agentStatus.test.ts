import { describe, expect, it } from 'vitest'
import type { Status } from '../../types'
import { agentBucket, statusKind } from './agentStatus'

describe('statusKind', () => {
  it('treats every in-flight state as live', () => {
    const live: Status[] = ['thinking', 'writing', 'reading', 'waiting']
    expect(live.map(statusKind)).toEqual(['live', 'live', 'live', 'live'])
  })

  it('maps finished, failed and resting states to their own families', () => {
    expect(statusKind('completed')).toBe('done')
    expect(statusKind('failed')).toBe('failed')
    expect(statusKind('idle')).toBe('idle')
    expect(statusKind('stopped')).toBe('idle')
  })
})

describe('agentBucket', () => {
  it('puts working agents in running', () => {
    expect(agentBucket('thinking')).toBe('running')
    expect(agentBucket('writing')).toBe('running')
    expect(agentBucket('reading')).toBe('running')
  })

  it('puts blocked and failed agents in attention, even though waiting is a live state', () => {
    expect(agentBucket('waiting')).toBe('attention')
    expect(agentBucket('failed')).toBe('attention')
  })

  it('separates finished from resting agents', () => {
    expect(agentBucket('completed')).toBe('done')
    expect(agentBucket('idle')).toBe('idle')
    expect(agentBucket('stopped')).toBe('idle')
  })
})
