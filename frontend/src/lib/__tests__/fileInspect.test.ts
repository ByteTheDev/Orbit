import { describe, expect, it } from 'vitest'
import { formatBytes, sameChanges, statusLabel } from '../fileInspect'
import type { GitFileState } from '../../types'

const state = (over: Partial<GitFileState>): GitFileState => ({
  index: ' ',
  worktree: 'M',
  staged: false,
  unstaged: true,
  untracked: false,
  ...over,
})

describe('statusLabel', () => {
  it('reads the common git states', () => {
    expect(statusLabel(state({}), true, true)).toEqual({ label: 'Modified', tone: 'info' })
    expect(statusLabel(state({ untracked: true, index: '?', worktree: '?' }), true, true).label).toBe('New')
    expect(statusLabel(state({ worktree: 'D' }), false, true).label).toBe('Deleted')
    expect(statusLabel(state({ index: 'A', worktree: ' ', staged: true, unstaged: false }), true, true).label).toBe('Added')
  })

  it('says what is missing when there is no git state', () => {
    expect(statusLabel(null, true, true).label).toBe('Unchanged')
    expect(statusLabel(null, false, true)).toEqual({ label: 'Missing', tone: 'danger' })
    expect(statusLabel(null, true, false)).toEqual({ label: 'Not in git', tone: 'muted' })
  })
})

describe('sameChanges', () => {
  it('matches an agent edit to the working-tree diff that adds and removes the same lines', () => {
    const edit = '- const a = 1\n+ const a = 2\n'
    const git = '@@ -40,1 +40,1 @@\n-const a = 1\n+const a = 2\n'
    expect(sameChanges(edit, git)).toBe(true)
  })

  it('treats different changes, and empty diffs, as not the same', () => {
    expect(sameChanges('- a\n+ b\n', '@@ -1 +1 @@\n-a\n+c\n')).toBe(false)
    expect(sameChanges('', '')).toBe(false)
  })
})

describe('formatBytes', () => {
  it('uses bytes, kilobytes and megabytes', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(4300)).toBe('4.2 KB')
    expect(formatBytes(2 * 1024 * 1024)).toBe('2.0 MB')
  })
})
