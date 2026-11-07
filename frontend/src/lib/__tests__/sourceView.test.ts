import { describe, expect, it } from 'vitest'
import {
  ancestorDirs,
  changedFolders,
  joinRel,
  markFor,
  nameProblem,
  nextIndex,
  pickAttachTarget,
  parentRel,
  parseUnifiedDiff,
  splitRows,
  visibleRows,
  writerLabel,
  writersByPath,
} from '../sourceView'
import type { AgentSummary, FileEntry, GitChange } from '../../types'

const file = (path: string): FileEntry => ({ name: path.split('/').pop() as string, path, isDir: false, size: 1, modTime: 0 })
const dir = (path: string): FileEntry => ({ name: path.split('/').pop() as string, path, isDir: true, size: 0, modTime: 0 })

const change = (path: string, index: string, worktree: string, extra: Partial<GitChange> = {}): GitChange => ({
  path,
  staged: index !== ' ' && index !== '?',
  unstaged: worktree !== ' ',
  untracked: false,
  index,
  worktree,
  conflicted: false,
  ...extra,
})

describe('paths', () => {
  it('joins and splits relative paths', () => {
    expect(joinRel('', 'a.txt')).toBe('a.txt')
    expect(joinRel('src', 'a.txt')).toBe('src/a.txt')
    expect(parentRel('src/util/a.go')).toBe('src/util')
    expect(parentRel('a.go')).toBe('')
    expect(ancestorDirs('a/b/c.go')).toEqual(['a', 'a/b'])
    expect(ancestorDirs('top.go')).toEqual([])
  })
})

describe('visibleRows', () => {
  it('shows children only of expanded, loaded folders, in order', () => {
    const listings = {
      '': [dir('src'), file('README.md')],
      src: [dir('src/util'), file('src/main.go')],
      'src/util': [file('src/util/helpers.go')],
    }
    const rows = visibleRows(listings, new Set(['src']))
    expect(rows.map((r) => [r.entry.path, r.depth])).toEqual([
      ['src', 0],
      ['src/util', 1],
      ['src/main.go', 1],
      ['README.md', 0],
    ])
    // Expanding util as well reveals its child one level deeper.
    const deeper = visibleRows(listings, new Set(['src', 'src/util']))
    expect(deeper.find((r) => r.entry.path === 'src/util/helpers.go')?.depth).toBe(2)
  })

  it('does not show children of an unloaded folder', () => {
    expect(visibleRows({ '': [dir('x')] }, new Set(['x']))).toHaveLength(1)
  })
})

describe('git markers', () => {
  it('labels each state in words as well as a letter', () => {
    expect(markFor(change('a', ' ', 'M')).label).toBe('Modified')
    expect(markFor(change('a', 'A', ' ')).label).toBe('Added')
    expect(markFor(change('a', ' ', 'D')).label).toBe('Deleted')
    expect(markFor(change('a', 'R', ' ')).label).toBe('Renamed')
    expect(markFor(change('a', '?', '?', { untracked: true })).label).toBe('Untracked')
    expect(markFor(change('a', 'U', 'U', { conflicted: true })).label).toBe('Merge conflict')
  })

  it('marks every folder above a changed file', () => {
    const folders = changedFolders([change('src/util/a.go', ' ', 'M'), change('README.md', ' ', 'M')])
    expect([...folders].sort()).toEqual(['src', 'src/util'])
  })
})

describe('agent writers', () => {
  const agent = (id: string, name: string, files: { path: string; state: string }[]): AgentSummary =>
    ({ id, name, recentFiles: files.map((f) => ({ path: f.path, state: f.state, reads: 0, writes: 0, lastOp: '', lastAt: 0 })) }) as unknown as AgentSummary

  it('counts only agents that are writing a file right now', () => {
    const map = writersByPath([
      agent('1', 'Nova', [{ path: 'a.go', state: 'writing' }, { path: 'b.go', state: 'reading' }]),
      agent('2', 'Atlas', [{ path: 'a.go', state: 'writing' }, { path: 'a.go', state: 'writing' }]),
    ])
    expect(map.get('a.go')?.map((w) => w.agentName)).toEqual(['Nova', 'Atlas'])
    expect(map.has('b.go')).toBe(false)
  })

  it('summarises several writers', () => {
    expect(writerLabel([{ agentId: '1', agentName: 'Nova' }])).toBe('Nova')
    expect(writerLabel([{ agentId: '1', agentName: 'Nova' }, { agentId: '2', agentName: 'Atlas' }])).toBe('Nova and Atlas')
    const three = [1, 2, 3, 4].map((i) => ({ agentId: String(i), agentName: `A${i}` }))
    expect(writerLabel(three)).toBe('A1, A2 and 2 more')
  })
})

describe('parseUnifiedDiff', () => {
  const patch = [
    'diff --git a/x.sql b/x.sql',
    'index 1111..2222 100644',
    '--- a/x.sql',
    '+++ b/x.sql',
    '@@ -1,3 +1,3 @@',
    ' keep',
    '-- old comment',
    '+-- new comment',
    ' end',
    '',
  ].join('\n')

  it('keeps removed lines that look like headers as content, and numbers the lines', () => {
    const { rows, additions, deletions } = parseUnifiedDiff(patch)
    expect(additions).toBe(1)
    expect(deletions).toBe(1)
    const del = rows.find((r) => r.kind === 'del')
    expect(del?.text).toBe('- old comment')
    expect(del?.oldNo).toBe(2)
    const add = rows.find((r) => r.kind === 'add')
    expect(add?.newNo).toBe(2)
    expect(rows.filter((r) => r.kind === 'ctx').map((r) => [r.oldNo, r.newNo])).toEqual([
      [1, 1],
      [3, 3],
    ])
  })

  it('accepts any text, including an empty patch', () => {
    expect(parseUnifiedDiff('').rows).toEqual([])
    expect(parseUnifiedDiff('just words').rows[0].kind).toBe('meta')
  })
})

describe('splitRows', () => {
  it('pairs deletions with the additions that replace them', () => {
    const { rows } = parseUnifiedDiff('@@ -1,2 +1,3 @@\n-a\n-b\n+x\n+y\n+z\n c\n')
    const split = splitRows(rows)
    const pairs = split.map((r) => [r.left?.text ?? null, r.right?.text ?? null])
    expect(pairs).toEqual([
      ['@@ -1,2 +1,3 @@', null], // hunk header row
      ['a', 'x'],
      ['b', 'y'],
      [null, 'z'],
      ['c', 'c'],
    ])
  })
})

describe('nextIndex', () => {
  it('moves within bounds and starts from the ends when nothing is focused', () => {
    expect(nextIndex(-1, 3, 'ArrowDown')).toBe(0)
    expect(nextIndex(-1, 3, 'ArrowUp')).toBe(2)
    expect(nextIndex(2, 3, 'ArrowDown')).toBe(2)
    expect(nextIndex(0, 3, 'ArrowUp')).toBe(0)
    expect(nextIndex(1, 3, 'End')).toBe(2)
    expect(nextIndex(1, 3, 'Home')).toBe(0)
    expect(nextIndex(1, 3, 'x')).toBe(1)
    expect(nextIndex(0, 0, 'ArrowDown')).toBe(-1)
  })
})

describe('nameProblem', () => {
  it('accepts ordinary names and explains the rest', () => {
    expect(nameProblem('main.go')).toBeNull()
    expect(nameProblem('')).toMatch(/Name/)
    expect(nameProblem('a/b')).toMatch(/cannot contain/)
    expect(nameProblem('dot.')).toMatch(/dot/)
    expect(nameProblem('nul.txt')).toMatch(/reserved/)
    expect(nameProblem(' pad')).toMatch(/space/)
  })
})

describe('pickAttachTarget', () => {
  const a = (id: string, running: boolean) => ({ id, name: id.toUpperCase(), running }) as unknown as AgentSummary
  it('prefers the selected agent, then a running one, then the first', () => {
    const list = [a('x', false), a('y', true), a('z', false)]
    expect(pickAttachTarget(list, 'z')?.id).toBe('z')
    expect(pickAttachTarget(list, 'gone')?.id).toBe('y')
    expect(pickAttachTarget([a('x', false)], null)?.id).toBe('x')
    expect(pickAttachTarget([], null)).toBeNull()
  })
})
