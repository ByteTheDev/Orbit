import { describe, expect, it } from 'vitest'
import { changeLabel, groupChanges, rowKey } from '../gitChanges'
import type { GitChange } from '../../types'

function change(overrides: Partial<GitChange>): GitChange {
  return { path: 'a.go', staged: false, unstaged: false, untracked: false, conflicted: false, index: ' ', worktree: 'M', ...overrides }
}

describe('groupChanges', () => {
  it('lists a path changed on both sides in both groups', () => {
    const both = change({ path: 'both.go', staged: true, unstaged: true, index: 'M', worktree: 'M' })
    const groups = groupChanges([both])
    expect(groups.staged).toEqual([both])
    expect(groups.unstaged).toEqual([both])
  })

  it('keeps untracked files out of the staged group', () => {
    const fresh = change({ path: 'new.txt', untracked: true, unstaged: true, index: '?', worktree: '?' })
    const groups = groupChanges([fresh])
    expect(groups.staged).toEqual([])
    expect(groups.unstaged).toEqual([fresh])
  })

  it('returns two empty lists for a clean tree', () => {
    expect(groupChanges([])).toEqual({ staged: [], unstaged: [] })
  })
})

describe('changeLabel', () => {
  it('labels the index side from the index letter', () => {
    expect(changeLabel(change({ staged: true, index: 'A', worktree: ' ' }), 'staged')).toBe('Added')
  })

  it('labels an untracked file as new on the unstaged side', () => {
    expect(changeLabel(change({ untracked: true, unstaged: true, index: '?', worktree: '?' }), 'unstaged')).toBe('New')
  })

  it('falls back to a neutral word for codes it does not know', () => {
    expect(changeLabel(change({ worktree: 'X' }), 'unstaged')).toBe('Changed')
  })
})

describe('rowKey', () => {
  it('differs between the two sides of one path', () => {
    const c = change({ path: 'x.go' })
    expect(rowKey(c, 'staged')).not.toBe(rowKey(c, 'unstaged'))
  })
})
