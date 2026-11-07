import { describe, expect, it } from 'vitest'
import type { Conversation } from '../../types'
import { partnersOf, talkFor, talkStatus } from '../talk'

function talk(over: Partial<Conversation> = {}): Conversation {
  return {
    id: 't',
    projectId: 'p',
    agentAId: 'a',
    agentBId: 'b',
    members: ['a', 'b'],
    topic: 'split the parser',
    status: 'done',
    nextId: 'a',
    replies: 2,
    maxReplies: 8,
    lines: [],
    at: 100,
    ...over,
  }
}

describe('talkFor', () => {
  it('prefers an active talk the agent is in over a newer finished one', () => {
    const finished = talk({ id: 'old', at: 500 })
    const active = talk({ id: 'live', status: 'active', at: 100 })
    expect(talkFor([finished, active], 'a')?.id).toBe('live')
  })

  it('otherwise shows the most recent talk the agent is in', () => {
    const older = talk({ id: 'older', at: 100 })
    const newer = talk({ id: 'newer', at: 300 })
    expect(talkFor([older, newer], 'b')?.id).toBe('newer')
  })

  it('finds an agent that is a later member of a team talk', () => {
    const team = talk({ id: 'team', agentAId: 'a', agentBId: 'b', members: ['a', 'b', 'c'] })
    expect(talkFor([team], 'c')?.id).toBe('team')
  })

  it('ignores talks the agent is not part of', () => {
    expect(talkFor([talk({ agentAId: 'x', agentBId: 'y', members: ['x', 'y'] })], 'a')).toBeUndefined()
  })
})

describe('partnersOf', () => {
  it('lists everyone else in the talk, in speaking order', () => {
    const team = talk({ members: ['a', 'b', 'c'] })
    expect(partnersOf(team, 'a')).toEqual(['b', 'c'])
    expect(partnersOf(team, 'b')).toEqual(['a', 'c'])
  })
})

describe('talkStatus', () => {
  it('shows which reply is next while talking', () => {
    expect(talkStatus(talk({ status: 'active', replies: 2, maxReplies: 8 }))).toBe('Talking · reply 3 of 8')
  })

  it('reads the outcome of a finished talk', () => {
    expect(talkStatus(talk({ status: 'done', replies: 1 }))).toBe('Finished after 1 reply')
    expect(talkStatus(talk({ status: 'done', replies: 4 }))).toBe('Finished after 4 replies')
    expect(talkStatus(talk({ status: 'done', replies: 0 }))).toBe('Finished')
    expect(talkStatus(talk({ status: 'stopped' }))).toBe('Stopped')
    expect(talkStatus(talk({ status: 'failed', error: 'the other agent was busy' }))).toBe('Stopped early: the other agent was busy')
  })
})
