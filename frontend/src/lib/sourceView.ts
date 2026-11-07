// Pure helpers for the Files and Git sidebars: tree rows, git and agent markers, diff rows, and keyboard
// movement. Nothing here touches React, the store or the bridge, so it can be unit-tested directly.
import type { AgentSummary, FileEntry, GitChange } from '../types'

// ---- paths -------------------------------------------------------------------

/** Joins a folder and a name with a slash. A root folder of "" gives the bare name. */
export function joinRel(dir: string, name: string): string {
  return dir ? `${dir}/${name}` : name
}

/** The folder that contains rel. Root-level entries give "". */
export function parentRel(rel: string): string {
  const i = rel.lastIndexOf('/')
  return i < 0 ? '' : rel.slice(0, i)
}

/** Every folder above rel, outermost first: "a/b/c.go" gives ["a", "a/b"]. */
export function ancestorDirs(rel: string): string[] {
  const parts = rel.split('/')
  const out: string[] = []
  for (let i = 1; i < parts.length; i++) out.push(parts.slice(0, i).join('/'))
  return out
}

// ---- tree --------------------------------------------------------------------

export interface TreeRow {
  entry: FileEntry
  depth: number
}

/**
 * The rows the tree shows, top to bottom. Children of a folder appear only when the folder is
 * expanded and its listing is loaded. Loaded listings are keyed by folder ("" is the root).
 */
export function visibleRows(listings: Record<string, FileEntry[] | undefined>, expanded: ReadonlySet<string>): TreeRow[] {
  const rows: TreeRow[] = []
  const walk = (dir: string, depth: number) => {
    for (const entry of listings[dir] ?? []) {
      rows.push({ entry, depth })
      if (entry.isDir && expanded.has(entry.path)) walk(entry.path, depth + 1)
    }
  }
  walk('', 0)
  return rows
}

// ---- git markers ---------------------------------------------------------------

export type MarkTone = 'added' | 'modified' | 'deleted' | 'renamed' | 'untracked' | 'conflict'

export interface GitMark {
  /** A single letter in the style of VS Code and most editors. */
  letter: string
  /** Written out, for the tooltip and screen readers. */
  label: string
  tone: MarkTone
}

/** The label for one changed path. Index and worktree sides are both considered; the worse one wins. */
export function markFor(change: GitChange): GitMark {
  if (change.conflicted) return { letter: 'C', label: 'Merge conflict', tone: 'conflict' }
  if (change.untracked) return { letter: 'U', label: 'Untracked', tone: 'untracked' }
  const codes = [change.worktree, change.index]
  if (codes.includes('D')) return { letter: 'D', label: 'Deleted', tone: 'deleted' }
  if (codes.includes('R') || codes.includes('C')) return { letter: 'R', label: 'Renamed', tone: 'renamed' }
  if (codes.includes('A')) return { letter: 'A', label: 'Added', tone: 'added' }
  return { letter: 'M', label: 'Modified', tone: 'modified' }
}

/** Marks keyed by path. Renames are keyed by their new path. */
export function marksByPath(changes: GitChange[]): Map<string, GitMark> {
  const out = new Map<string, GitMark>()
  for (const c of changes) out.set(c.path, markFor(c))
  return out
}

/**
 * Folders that contain a change, so the tree can show a dot on a collapsed folder. A folder is marked
 * when any change sits anywhere beneath it.
 */
export function changedFolders(changes: GitChange[]): Set<string> {
  const out = new Set<string>()
  for (const c of changes) for (const dir of ancestorDirs(c.path)) out.add(dir)
  return out
}

/** Tailwind-free colour values for each tone, as CSS variables that the theme defines. */
export const TONE_COLOR: Record<MarkTone, string> = {
  added: 'var(--color-ok)',
  modified: 'var(--color-status-writing)',
  deleted: 'var(--color-danger)',
  renamed: 'var(--color-status-writing)',
  untracked: 'var(--color-faint)',
  conflict: 'var(--color-warn)',
}

// ---- agent activity --------------------------------------------------------------

export interface Writer {
  agentId: string
  agentName: string
}

/**
 * Which running agents are writing each file right now. Only the "writing" state counts: a file an
 * agent merely read is not being changed, so it is not marked.
 */
export function writersByPath(agents: AgentSummary[]): Map<string, Writer[]> {
  const out = new Map<string, Writer[]>()
  for (const a of agents) {
    for (const f of a.recentFiles ?? []) {
      if (f.state !== 'writing') continue
      const list = out.get(f.path) ?? []
      if (!list.some((w) => w.agentId === a.id)) list.push({ agentId: a.id, agentName: a.name })
      out.set(f.path, list)
    }
  }
  return out
}

/** A short phrase for who is writing a file, such as "Nova" or "Nova and Atlas". */
export function writerLabel(writers: Writer[]): string {
  const names = writers.map((w) => w.agentName)
  if (names.length <= 2) return names.join(' and ')
  return `${names[0]}, ${names[1]} and ${names.length - 2} more`
}

// ---- unified diff ------------------------------------------------------------------

export type DiffRowKind = 'add' | 'del' | 'ctx' | 'hunk' | 'meta'

export interface DiffRow {
  kind: DiffRowKind
  oldNo: number | null
  newNo: number | null
  text: string
}

const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/

/**
 * Parses a unified diff into rows with old and new line numbers. Unknown lines are kept as metadata,
 * so any text is accepted and nothing is thrown away.
 */
export function parseUnifiedDiff(text: string): { rows: DiffRow[]; additions: number; deletions: number } {
  const rows: DiffRow[] = []
  let oldNo = 0
  let newNo = 0
  let inHunk = false
  let additions = 0
  let deletions = 0
  const lines = text.split('\n')
  if (lines.length && lines[lines.length - 1] === '') lines.pop()
  for (const raw of lines) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw
    const hunk = HUNK_HEADER.exec(line)
    if (hunk) {
      oldNo = Number(hunk[1])
      newNo = Number(hunk[2])
      inHunk = true
      rows.push({ kind: 'hunk', oldNo: null, newNo: null, text: line })
      continue
    }
    // Headers come before a hunk. Inside one, "--- " is a removed line that starts with "-- ", not a header.
    if (line.startsWith('diff ')) inHunk = false
    if (!inHunk) {
      rows.push({ kind: 'meta', oldNo: null, newNo: null, text: line })
      continue
    }
    if (line.startsWith('+')) {
      rows.push({ kind: 'add', oldNo: null, newNo: newNo++, text: line.slice(1) })
      additions++
    } else if (line.startsWith('-')) {
      rows.push({ kind: 'del', oldNo: oldNo++, newNo: null, text: line.slice(1) })
      deletions++
    } else if (line.startsWith('\\')) {
      rows.push({ kind: 'meta', oldNo: null, newNo: null, text: line })
    } else {
      rows.push({ kind: 'ctx', oldNo: oldNo++, newNo: newNo++, text: line.startsWith(' ') ? line.slice(1) : line })
    }
  }
  return { rows, additions, deletions }
}

/**
 * Pairs deletions with the additions that replace them, for a side-by-side view. Context rows appear
 * on both sides. An unpaired deletion or addition leaves the other side empty.
 */
export interface SplitRow {
  left: DiffRow | null
  right: DiffRow | null
}

export function splitRows(rows: DiffRow[]): SplitRow[] {
  const out: SplitRow[] = []
  let i = 0
  while (i < rows.length) {
    const r = rows[i]
    if (r.kind === 'ctx' || r.kind === 'hunk' || r.kind === 'meta') {
      out.push({ left: r, right: r.kind === 'ctx' ? r : null })
      i++
      continue
    }
    // Collect a run of deletions and the additions that follow, then pair them up.
    const dels: DiffRow[] = []
    const adds: DiffRow[] = []
    while (i < rows.length && rows[i].kind === 'del') dels.push(rows[i++])
    while (i < rows.length && rows[i].kind === 'add') adds.push(rows[i++])
    const n = Math.max(dels.length, adds.length)
    for (let k = 0; k < n; k++) out.push({ left: dels[k] ?? null, right: adds[k] ?? null })
  }
  return out
}

// ---- keyboard ----------------------------------------------------------------------

/**
 * The index to move to for a list navigation key. Returns the current index unchanged for keys it
 * does not handle. count is the number of items; -1 current means nothing is focused yet.
 */
export function nextIndex(current: number, count: number, key: string): number {
  if (count <= 0) return -1
  switch (key) {
    case 'ArrowDown':
      return current < 0 ? 0 : Math.min(count - 1, current + 1)
    case 'ArrowUp':
      return current < 0 ? count - 1 : Math.max(0, current - 1)
    case 'Home':
      return 0
    case 'End':
      return count - 1
    default:
      return current
  }
}

/** Compares two paths the way the tree sorts names: case-insensitively. */
export function compareNames(a: string, b: string): number {
  return a.toLowerCase().localeCompare(b.toLowerCase())
}

/** Whether a name is a valid Windows-friendly file name. Mirrors the backend check for instant feedback. */
export function nameProblem(name: string): string | null {
  if (name.trim() === '') return 'Name the file or folder.'
  if (name !== name.trim()) return 'Names cannot start or end with a space.'
  if (name === '.' || name === '..') return 'That name is reserved.'
  if (/[<>:"/\\|?*\x00-\x1f]/.test(name)) return 'Names cannot contain < > : " / \\ | ? *'
  if (name.endsWith('.')) return 'Names cannot end with a dot.'
  const base = name.split('.')[0].toUpperCase()
  if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/.test(base)) return `${name} is a reserved name on Windows.`
  return null
}

/**
 * The agent a file is attached to: the one selected in the inspector when it belongs to the project,
 * otherwise a running agent, otherwise the first agent. Null when the project has no agents.
 */
export function pickAttachTarget(agents: AgentSummary[], selectedId: string | null): AgentSummary | null {
  if (agents.length === 0) return null
  const selected = agents.find((a) => a.id === selectedId)
  if (selected) return selected
  return agents.find((a) => a.running) ?? agents[0]
}
