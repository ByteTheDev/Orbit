// Agent-to-agent talks: which one an agent should show, and what its status reads. Pure, so the
// rules are tested without React. The showcase in the inspector draws whatever this returns.
import type { Conversation } from '../types'

/** Whether an agent takes part in a talk. */
export function inTalk(c: Conversation, agentId: string): boolean {
  return c.members.includes(agentId)
}

/**
 * The talk an agent should show: an active talk it is in first, otherwise its most recent talk.
 * Undefined when the agent has never talked with another agent.
 */
export function talkFor(conversations: Conversation[], agentId: string): Conversation | undefined {
  let best: Conversation | undefined
  for (const c of conversations) {
    if (!inTalk(c, agentId)) continue
    if (!best) {
      best = c
      continue
    }
    const cActive = c.status === 'active'
    const bestActive = best.status === 'active'
    if (cActive !== bestActive) {
      if (cActive) best = c
      continue
    }
    if (c.at > best.at) best = c
  }
  return best
}

/** The other agents in a talk, from the point of view of agentId, in speaking order. */
export function partnersOf(c: Conversation, agentId: string): string[] {
  return c.members.filter((id) => id !== agentId)
}

/** A short status line for a talk, for the showcase header. */
export function talkStatus(c: Conversation): string {
  switch (c.status) {
    case 'active':
      return `Talking · reply ${Math.min(c.replies + 1, c.maxReplies)} of ${c.maxReplies}`
    case 'done':
      if (c.replies === 0) return 'Finished'
      return `Finished after ${c.replies} ${c.replies === 1 ? 'reply' : 'replies'}`
    case 'stopped':
      return 'Stopped'
    case 'failed':
      return c.error ? `Stopped early: ${c.error}` : 'Stopped early'
    default:
      return ''
  }
}
