// Pure helpers for the Changes tab. No React and no bridge calls, so they can be unit-tested.
import type { GitChange } from '../types'

export type ChangeSide = 'staged' | 'unstaged'

export interface ChangeGroups {
  staged: GitChange[]
  unstaged: GitChange[]
}

/**
 * Splits changes into what is staged and what is not. A path changed on both sides
 * appears in both lists, because it can be staged and unstaged independently.
 */
export function groupChanges(changes: GitChange[]): ChangeGroups {
  return {
    staged: changes.filter((c) => c.staged),
    unstaged: changes.filter((c) => c.unstaged),
  }
}

const LABELS: Record<string, string> = {
  M: 'Modified',
  A: 'Added',
  D: 'Deleted',
  R: 'Renamed',
  C: 'Copied',
  U: 'Conflict',
  T: 'Type changed',
  '?': 'New',
}

/** A short word for one side of a change, such as "Modified" or "New". */
export function changeLabel(change: GitChange, side: ChangeSide): string {
  if (side === 'unstaged' && change.untracked) return 'New'
  const code = side === 'staged' ? change.index : change.worktree
  return LABELS[code] ?? 'Changed'
}

/** The key that identifies one row, since a path can appear in both lists. */
export function rowKey(change: GitChange, side: ChangeSide): string {
  return `${side}:${change.path}`
}
