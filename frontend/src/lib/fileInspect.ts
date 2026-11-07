// Pure helpers for the file inspector: how a file's git state reads, when two diffs say the same
// thing, and how sizes read. No React and no bridge calls.
import type { GitFileState } from '../types'
import { parsePatch } from './diff'

export type Tone = 'ok' | 'warn' | 'danger' | 'info' | 'muted'

export interface StatusLabel {
  label: string
  tone: Tone
}

/** The word for a file's git state, such as "Modified" or "New". */
export function statusLabel(state: GitFileState | null, exists: boolean, inRepo: boolean): StatusLabel {
  if (!inRepo) return { label: 'Not in git', tone: 'muted' }
  if (!state) return exists ? { label: 'Unchanged', tone: 'muted' } : { label: 'Missing', tone: 'danger' }
  if (state.untracked) return { label: 'New', tone: 'ok' }
  if (state.index === 'R' || state.worktree === 'R') return { label: 'Renamed', tone: 'info' }
  if (state.index === 'D' || state.worktree === 'D') return { label: 'Deleted', tone: 'danger' }
  if (state.index === 'A') return { label: 'Added', tone: 'ok' }
  if (state.index === 'U' || state.worktree === 'U') return { label: 'Conflict', tone: 'danger' }
  return { label: 'Modified', tone: 'info' }
}

/** The changed lines of a diff as "kind:text" entries, sorted, so two diffs can be compared. */
export function changedLines(text: string): string[] {
  const out: string[] = []
  for (const hunk of parsePatch(text).hunks) {
    for (const l of hunk.lines) {
      if (l.kind !== 'ctx') out.push(`${l.kind}:${l.text.replace(/\r$/, '')}`)
    }
  }
  return out.sort()
}

/**
 * True when two diffs add and remove exactly the same lines. Hunk positions and headers are ignored,
 * because an agent's edit and the working-tree diff locate the same change differently.
 */
export function sameChanges(a: string, b: string): boolean {
  const x = changedLines(a)
  const y = changedLines(b)
  if (x.length === 0 || x.length !== y.length) return false
  return x.every((v, i) => v === y[i])
}

/** A size in bytes, as "512 B", "4.2 KB" or "1.3 MB". */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}
