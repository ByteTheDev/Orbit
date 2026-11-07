// How an agent's status reads in the navigator. Pure, so the grouping can be tested without React.
import type { Status } from '../../types'

/**
 * The four visual families the sidebar draws. Each has its own shape as well as its colour,
 * so a status still reads when colour is hard to see.
 * - live: the agent is doing something right now (pulsing dot)
 * - done: finished successfully (check)
 * - failed: stopped with an error (cross)
 * - idle: at rest, or stopped by the user (hollow ring)
 */
export type StatusKind = 'live' | 'done' | 'failed' | 'idle'

export function statusKind(status: Status): StatusKind {
  switch (status) {
    case 'thinking':
    case 'writing':
    case 'reading':
    case 'waiting':
      return 'live'
    case 'completed':
      return 'done'
    case 'failed':
      return 'failed'
    case 'idle':
    case 'stopped':
      return 'idle'
  }
}

/**
 * The group an agent falls into for filtering and the Active section. Attention outranks
 * running, so an agent blocked on a permission prompt or a failure never hides in the live group.
 * - running: doing work now
 * - attention: blocked (waiting for permission) or failed; needs the user
 * - done: finished its last turn successfully
 * - idle: at rest, or stopped by the user
 */
export type AgentBucket = 'running' | 'attention' | 'done' | 'idle'

/** Every bucket, in the order the filter chips show them. */
export const AGENT_BUCKETS: AgentBucket[] = ['running', 'attention', 'done', 'idle']

export const BUCKET_LABEL: Record<AgentBucket, string> = {
  running: 'Running',
  attention: 'Attention',
  done: 'Done',
  idle: 'Idle',
}

export function agentBucket(status: Status): AgentBucket {
  if (status === 'failed' || status === 'waiting') return 'attention'
  switch (statusKind(status)) {
    case 'live':
      return 'running'
    case 'done':
      return 'done'
    default:
      return 'idle'
  }
}
