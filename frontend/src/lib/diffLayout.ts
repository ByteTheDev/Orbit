// Turns a parsed patch into the flat rows the diff viewer draws. Pure, so the folding, pairing
// and navigation rules can be tested without rendering anything.
import type { DiffHunk, DiffLine, ParsedPatch } from './diff'
import { intraline, type Segment } from './wordDiff'

/** Unchanged lines kept on each side of a change. */
export const CONTEXT = 3
/** The shortest run of unchanged lines that is folded. Shorter runs are shown. */
export const MIN_FOLD = 6

export interface Cell {
  line: DiffLine
  segs: Segment[] | null
}

export type Row =
  | { type: 'hunk'; hunk: number; title: string; header: string; additions: number; deletions: number; patch: string }
  | { type: 'line'; hunk: number; change: number | null; line: DiffLine; segs: Segment[] | null }
  | { type: 'pair'; hunk: number; change: number | null; left: Cell | null; right: Cell | null }
  | { type: 'fold'; hunk: number; key: string; count: number; expanded: boolean }

export interface HunkStop {
  row: number
  label: string
  additions: number
  deletions: number
}

export interface Layout {
  rows: Row[]
  /** The row where each change starts, in document order. Previous and next jump between these. */
  changes: number[]
  hunks: HunkStop[]
  /** The key of every fold, so the viewer can expand them all at once. */
  folds: string[]
  /** The longest line in characters. The viewer sizes its width from it. */
  maxChars: number
}

export interface LayoutOptions {
  /** Side by side instead of one column. */
  split: boolean
  /** Fold keys that the user has expanded. */
  expanded: ReadonlySet<string>
  /** Whether to fold unchanged context. A file view shows every line, so it turns this off. */
  fold: boolean
}

export function buildLayout(patch: ParsedPatch, opts: LayoutOptions): Layout {
  const rows: Row[] = []
  const changes: number[] = []
  const hunks: HunkStop[] = []
  const folds: string[] = []
  let maxChars = 0
  let changeCount = 0

  patch.hunks.forEach((hunk, hi) => {
    for (const l of hunk.lines) maxChars = Math.max(maxChars, l.text.length)
    const lines = hunk.lines
    const n = lines.length
    const keep = keepFlags(lines, opts.fold)
    const segsOf = pairSegments(lines)

    hunks.push({ row: rows.length, label: hunk.title || hunk.header || `Hunk ${hi + 1}`, additions: hunk.additions, deletions: hunk.deletions })
    rows.push({ type: 'hunk', hunk: hi, title: hunk.title, header: hunk.header, additions: hunk.additions, deletions: hunk.deletions, patch: hunkPatch(hunk) })

    const ctx = (i: number) => {
      if (opts.split) rows.push({ type: 'pair', hunk: hi, change: null, left: cell(lines[i], null), right: cell(lines[i], null) })
      else rows.push({ type: 'line', hunk: hi, change: null, line: lines[i], segs: null })
    }

    let i = 0
    while (i < n) {
      if (lines[i].kind === 'ctx' && !keep[i]) {
        let e = i
        while (e < n && lines[e].kind === 'ctx' && !keep[e]) e++
        if (e - i >= MIN_FOLD) {
          const key = `${hi}:${i}`
          folds.push(key)
          const expanded = opts.expanded.has(key)
          rows.push({ type: 'fold', hunk: hi, key, count: e - i, expanded })
          if (expanded) for (let k = i; k < e; k++) ctx(k)
          i = e
          continue
        }
      }
      if (lines[i].kind === 'ctx') {
        ctx(i)
        i++
        continue
      }
      // A change: a run of removed and added lines. They share one number for navigation.
      let e = i
      while (e < n && lines[e].kind !== 'ctx') e++
      const change = ++changeCount
      changes.push(rows.length)
      if (opts.split) {
        for (const [left, right] of pairChange(lines, i, e)) {
          rows.push({ type: 'pair', hunk: hi, change, left: left ? cell(left, segsOf) : null, right: right ? cell(right, segsOf) : null })
        }
      } else {
        for (let k = i; k < e; k++) rows.push({ type: 'line', hunk: hi, change, line: lines[k], segs: segsOf.get(lines[k]) ?? null })
      }
      i = e
    }
  })

  return { rows, changes, hunks, folds, maxChars }
}

/** Which lines are shown: all of them, or the ones within CONTEXT of a change. */
function keepFlags(lines: DiffLine[], fold: boolean): boolean[] {
  const keep = new Array<boolean>(lines.length).fill(!fold)
  if (!fold) return keep
  lines.forEach((l, i) => {
    if (l.kind === 'ctx') return
    for (let j = Math.max(0, i - CONTEXT); j <= Math.min(lines.length - 1, i + CONTEXT); j++) keep[j] = true
  })
  return keep
}

/**
 * Character pairs the word diff may spend across one patch. Past it, the remaining modified lines
 * show their change as whole lines. That keeps a huge diff from stalling the window.
 */
const WORD_DIFF_BUDGET = 3_000_000

/** Word-level segments for each removed line and the added line it is paired with. */
function pairSegments(lines: DiffLine[]): Map<DiffLine, Segment[]> {
  const segs = new Map<DiffLine, Segment[]>()
  let budget = WORD_DIFF_BUDGET
  let i = 0
  while (i < lines.length) {
    if (lines[i].kind === 'ctx') {
      i++
      continue
    }
    let e = i
    while (e < lines.length && lines[e].kind !== 'ctx') e++
    for (const [left, right] of pairChange(lines, i, e)) {
      if (!left || !right) continue
      const cost = left.text.length * right.text.length
      if (cost > budget) continue
      budget -= cost
      const pair = intraline(left.text, right.text)
      segs.set(left, pair.old)
      segs.set(right, pair.new)
    }
    i = e
  }
  return segs
}

/**
 * Pairs the i-th removed line with the i-th added line of one change, the way a side-by-side diff
 * lines them up. Unpaired lines on either side get a null partner.
 */
function pairChange(lines: DiffLine[], start: number, end: number): [DiffLine | null, DiffLine | null][] {
  const dels: DiffLine[] = []
  const adds: DiffLine[] = []
  for (let k = start; k < end; k++) (lines[k].kind === 'del' ? dels : adds).push(lines[k])
  const out: [DiffLine | null, DiffLine | null][] = []
  for (let k = 0; k < Math.max(dels.length, adds.length); k++) out.push([dels[k] ?? null, adds[k] ?? null])
  return out
}

function cell(line: DiffLine, segsOf: Map<DiffLine, Segment[]> | null): Cell {
  return { line, segs: segsOf?.get(line) ?? null }
}

/** The hunk as a patch that git can apply, for the copy button. */
export function hunkPatch(hunk: DiffHunk): string {
  const body = hunk.lines.map((l) => (l.kind === 'add' ? '+' : l.kind === 'del' ? '-' : ' ') + l.text)
  return (hunk.header ? [hunk.header, ...body] : body).join('\n')
}
