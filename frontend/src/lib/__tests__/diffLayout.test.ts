import { describe, expect, it } from 'vitest'
import { parsePatch, contentAsPatch } from '../diff'
import { buildLayout, CONTEXT, MIN_FOLD, hunkPatch, type Row } from '../diffLayout'

const GIT = [
  'diff --git a/src/a.ts b/src/a.ts',
  'index 1111..2222 100644',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -12,3 +12,4 @@ export function f() {',
  '   const x = 1',
  '-  return 0',
  '+  if (ready) return 1',
  '+  return 0',
  '   // end',
].join('\n')

/** A file with one change in the middle of many unchanged lines. */
function longGitDiff(): string {
  const body: string[] = []
  for (let i = 1; i <= 30; i++) body.push(i === 15 ? '-old 15' : ' line ' + i)
  body.push('+new 15')
  return ['@@ -1,30 +1,31 @@', ...body].join('\n')
}

describe('parsePatch', () => {
  it('reads git hunks with their titles and counts', () => {
    const p = parsePatch(GIT)
    expect(p.git).toBe(true)
    expect(p.hunks).toHaveLength(1)
    expect(p.hunks[0].title).toBe('export function f() {')
    expect(p.hunks[0].header).toBe('@@ -12,3 +12,4 @@')
    expect(p.additions).toBe(2)
    expect(p.deletions).toBe(1)
    expect(p.header).toContain('--- a/src/a.ts')
  })

  it('reads agent edits as unnumbered blocks, one per edit', () => {
    const p = parsePatch('- const a = 1\n+ const a = 2\n\n+ extra\n')
    expect(p.git).toBe(false)
    expect(p.hunks.map((h) => h.title)).toEqual(['Edit 1', 'Edit 2'])
    expect(p.hunks[0].lines.map((l) => [l.kind, l.oldNo, l.newNo])).toEqual([
      ['del', null, null],
      ['add', null, null],
    ])
    expect(p.additions).toBe(2)
    expect(p.deletions).toBe(1)
  })

  it('treats a line of "-" or "+" alone as an empty change, not a separator', () => {
    const p = parsePatch('-\n+\n')
    expect(p.hunks[0].lines.map((l) => l.kind)).toEqual(['del', 'add'])
  })

  it('shows a whole file as context lines with their numbers', () => {
    const p = contentAsPatch('one\ntwo\n')
    expect(p.hunks[0].lines.map((l) => [l.kind, l.oldNo, l.text])).toEqual([
      ['ctx', 1, 'one'],
      ['ctx', 2, 'two'],
    ])
    expect(contentAsPatch('').hunks).toEqual([])
  })
})

describe('buildLayout', () => {
  it('folds unchanged context far from a change and keeps the lines next to it', () => {
    const layout = buildLayout(parsePatch(longGitDiff()), { split: false, expanded: new Set(), fold: true })
    const folds = layout.rows.filter((r): r is Extract<Row, { type: 'fold' }> => r.type === 'fold')
    expect(folds.length).toBe(2)
    expect(folds[0].count).toBe(14 - CONTEXT)
    const shown = layout.rows.filter((r) => r.type === 'line').map((r) => (r.type === 'line' ? r.line.text : ''))
    // The lines within CONTEXT of the change at 15 are visible, the rest are folded.
    expect(shown).toContain('line 12')
    expect(shown).not.toContain('line 1')
    expect(shown).not.toContain('line 25')
  })

  it('expands one fold without expanding the others', () => {
    const first = buildLayout(parsePatch(longGitDiff()), { split: false, expanded: new Set(), fold: true })
    const key = first.folds[0]
    const layout = buildLayout(parsePatch(longGitDiff()), { split: false, expanded: new Set([key]), fold: true })
    const texts = layout.rows.filter((r) => r.type === 'line').map((r) => (r.type === 'line' ? r.line.text : ''))
    expect(texts).toContain('line 1')
    expect(texts).not.toContain('line 25')
  })

  it('does not fold short runs, which would hide less than they save', () => {
    const body = [' a', ' b', ' c', '-x', '+y']
    for (let i = 0; i < MIN_FOLD - 1; i++) body.push(' pad ' + i)
    const layout = buildLayout(parsePatch(['@@ -1,3 +1,3 @@', ...body].join('\n')), { split: false, expanded: new Set(), fold: true })
    expect(layout.folds).toEqual([])
  })

  it('shows every line when folding is off, as a file view does', () => {
    const layout = buildLayout(contentAsPatch(longGitDiff()), { split: false, expanded: new Set(), fold: false })
    expect(layout.rows.some((r) => r.type === 'fold')).toBe(false)
  })

  it('records where each change starts, for previous and next', () => {
    const layout = buildLayout(parsePatch(longGitDiff()), { split: false, expanded: new Set(), fold: false })
    expect(layout.changes).toHaveLength(2)
    expect(layout.rows[layout.changes[0]]).toMatchObject({ type: 'line', line: { kind: 'del' } })
  })

  it('pairs removed and added lines side by side and marks their changed words', () => {
    const layout = buildLayout(parsePatch(GIT), { split: true, expanded: new Set(), fold: false })
    const pair = layout.rows.find((r) => r.type === 'pair' && r.left?.line.kind === 'del')
    expect(pair).toBeDefined()
    if (pair?.type !== 'pair') throw new Error('no pair')
    expect(pair.right?.line.kind).toBe('add')
    expect(pair.left?.segs?.some((s) => s.changed)).toBe(true)
    // The second added line has no removed partner, so its left side is empty.
    const orphan = layout.rows.filter((r) => r.type === 'pair' && r.left === null)
    expect(orphan.length).toBe(1)
  })

  it('reports the longest line so the viewer can size its width', () => {
    const layout = buildLayout(parsePatch(GIT), { split: false, expanded: new Set(), fold: false })
    expect(layout.maxChars).toBe('  if (ready) return 1'.length)
  })

  it('copies a hunk as a patch with its header and prefixes', () => {
    const p = parsePatch(GIT)
    expect(hunkPatch(p.hunks[0]).split('\n')[0]).toBe('@@ -12,3 +12,4 @@')
    expect(hunkPatch(p.hunks[0])).toContain('-  return 0')
  })
})
