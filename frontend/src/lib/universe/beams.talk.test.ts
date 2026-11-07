import { describe, expect, it } from 'vitest'
import { computeBeams } from './beams'
import type { AgentSummary, Conversation } from '../../types'

function agent(id: string): AgentSummary {
  return { id, projectId: 'p1', name: id, recentFiles: [] } as unknown as AgentSummary
}

function talk(over: Partial<Conversation> = {}): Conversation {
  return {
    id: 'c1',
    projectId: 'p1',
    agentAId: 'a',
    agentBId: 'b',
    members: ['a', 'b'],
    topic: 'split the parser',
    status: 'active',
    nextId: 'a',
    replies: 1,
    maxReplies: 8,
    lines: [],
    at: 1000,
    ...over,
  }
}

describe('computeBeams: talks', () => {
  it('draws an active talk between its two agents as a talk beam', () => {
    const beams = computeBeams([agent('a'), agent('b')], [], 2000, [talk()])
    expect(beams).toEqual([{ key: 't:c1:0', kind: 'talk', fromId: 'a', toId: 'b', files: [], age: 0 }])
  })

  it('joins a team of three as a ring', () => {
    const team = talk({ members: ['a', 'b', 'c'], agentAId: 'a', agentBId: 'b' })
    const beams = computeBeams([agent('a'), agent('b'), agent('c')], [], 2000, [team])
    expect(beams.map((b) => [b.fromId, b.toId])).toEqual([
      ['a', 'b'],
      ['b', 'c'],
      ['c', 'a'],
    ])
  })

  it('stops drawing a talk once it is finished', () => {
    const beams = computeBeams([agent('a'), agent('b')], [], 2000, [talk({ status: 'done' })])
    expect(beams).toEqual([])
  })

  it('drops talks whose agents are gone', () => {
    expect(computeBeams([agent('a')], [], 2000, [talk()])).toEqual([])
  })
})
