// Parses a unified diff into rows with old and new line numbers, for the file inspector.
// It is tolerant by design: any text is accepted, and unrecognised lines are kept as metadata.

export type DiffKind = 'add' | 'del' | 'ctx' | 'hunk' | 'meta'

export interface DiffRow {
  kind: DiffKind
  /** Line number in the old file, or null where the row does not exist there. */
  oldNo: number | null
  /** Line number in the new file, or null where the row does not exist there. */
  newNo: number | null
  text: string
}

export interface ParsedDiff {
  rows: DiffRow[]
  additions: number
  deletions: number
}

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/

export function parseDiff(text: string): ParsedDiff {
  const lines = (text || '').split('\n')
  // A trailing newline produces an empty final line that is not part of the diff.
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()

  const rows: DiffRow[] = []
  let additions = 0
  let deletions = 0
  let oldNo = 0
  let newNo = 0
  let inHunk = false

  for (const raw of lines) {
    if (raw.startsWith('diff ') || raw.startsWith('index ')) {
      inHunk = false
      rows.push({ kind: 'meta', oldNo: null, newNo: null, text: raw })
      continue
    }
    if (raw.startsWith('@@')) {
      const m = HUNK.exec(raw)
      if (m) {
        oldNo = Number(m[1])
        newNo = Number(m[2])
        inHunk = true
      }
      rows.push({ kind: 'hunk', oldNo: null, newNo: null, text: raw })
      continue
    }
    // File headers come before the first hunk. Inside a hunk, "--" and "++" are real content.
    if (!inHunk) {
      rows.push({ kind: 'meta', oldNo: null, newNo: null, text: raw })
      continue
    }
    if (raw.startsWith('+')) {
      rows.push({ kind: 'add', oldNo: null, newNo, text: raw.slice(1) })
      newNo++
      additions++
    } else if (raw.startsWith('-')) {
      rows.push({ kind: 'del', oldNo, newNo: null, text: raw.slice(1) })
      oldNo++
      deletions++
    } else if (raw.startsWith('\\')) {
      // "\ No newline at end of file"
      rows.push({ kind: 'meta', oldNo: null, newNo: null, text: raw })
    } else {
      rows.push({ kind: 'ctx', oldNo, newNo, text: raw.startsWith(' ') ? raw.slice(1) : raw })
      oldNo++
      newNo++
    }
  }

  return { rows, additions, deletions }
}

export interface DiffLine {
  kind: 'add' | 'del' | 'ctx'
  oldNo: number | null
  newNo: number | null
  text: string
  /** Highlighted HTML for the line. The viewer fills it in; when absent the text is shown plain. */
  html?: string
}

export interface DiffHunk {
  /** The full @@ header of a git hunk, or '' for an agent edit, which has no line numbers. */
  header: string
  /** The name the UI shows: the function a git hunk is in, or "Edit n" for an agent edit. */
  title: string
  additions: number
  deletions: number
  lines: DiffLine[]
}

export interface ParsedPatch {
  /** True for a git diff with @@ hunks. False for the edits Orbit records from agent tool calls. */
  git: boolean
  /** Git's file header lines (diff --git, index, ---, +++). Empty for agent edits. */
  header: string[]
  hunks: DiffHunk[]
  additions: number
  deletions: number
}

const HUNK_HEADER = /^(@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@)\s?(.*)$/

/**
 * Reads either a git diff or an agent edit. Agent edits are "- old" and "+ new" lines with no
 * @@ header, one block per edit, blocks separated by a blank line. Anything else is read as git.
 */
export function parsePatch(text: string): ParsedPatch {
  const source = text || ''
  // A git diff of a binary file or a pure rename has a header but no hunk. It must not be read as an edit.
  if (/^@@ -\d/m.test(source) || /^diff --git /m.test(source)) return parseGitPatch(source)
  return parseEditPatch(source)
}

function parseGitPatch(text: string): ParsedPatch {
  const { rows } = parseDiff(text)
  const header: string[] = []
  const hunks: DiffHunk[] = []
  let current: DiffHunk | null = null
  for (const r of rows) {
    if (r.kind === 'hunk') {
      const m = HUNK_HEADER.exec(r.text)
      current = { header: m ? m[1] : r.text, title: m ? m[2].trim() : '', additions: 0, deletions: 0, lines: [] }
      hunks.push(current)
      continue
    }
    if (r.kind === 'meta') {
      // Before the first hunk these are file headers. Inside a hunk, meta rows ("\ No newline") carry no line.
      if (!current) header.push(r.text)
      continue
    }
    if (!current) continue
    current.lines.push({ kind: r.kind, oldNo: r.oldNo, newNo: r.newNo, text: r.text })
    if (r.kind === 'add') current.additions++
    if (r.kind === 'del') current.deletions++
  }
  return withTotals({ git: true, header, hunks, additions: 0, deletions: 0 })
}

function parseEditPatch(text: string): ParsedPatch {
  const lines = text.split('\n')
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  const hunks: DiffHunk[] = []
  let block: DiffLine[] = []
  const flush = () => {
    if (block.length === 0) return
    const hunk: DiffHunk = { header: '', title: `Edit ${hunks.length + 1}`, additions: 0, deletions: 0, lines: block }
    for (const l of block) {
      if (l.kind === 'add') hunk.additions++
      if (l.kind === 'del') hunk.deletions++
    }
    hunks.push(hunk)
    block = []
  }
  for (const raw of lines) {
    if (raw === '') {
      flush()
      continue
    }
    if (raw === '-' || raw.startsWith('- ')) block.push({ kind: 'del', oldNo: null, newNo: null, text: raw.slice(2) })
    else if (raw === '+' || raw.startsWith('+ ')) block.push({ kind: 'add', oldNo: null, newNo: null, text: raw.slice(2) })
    else block.push({ kind: 'ctx', oldNo: null, newNo: null, text: raw })
  }
  flush()
  return withTotals({ git: false, header: [], hunks, additions: 0, deletions: 0 })
}

/** A whole file as one unnumbered-by-change block, for viewing a file version without a diff. */
export function contentAsPatch(text: string): ParsedPatch {
  const lines = (text || '').split('\n')
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  const hunk: DiffHunk = {
    header: '',
    title: '',
    additions: 0,
    deletions: 0,
    lines: lines.map((t, i) => ({ kind: 'ctx' as const, oldNo: i + 1, newNo: i + 1, text: t })),
  }
  return withTotals({ git: false, header: [], hunks: lines.length ? [hunk] : [], additions: 0, deletions: 0 })
}

function withTotals(p: ParsedPatch): ParsedPatch {
  p.additions = p.hunks.reduce((n, h) => n + h.additions, 0)
  p.deletions = p.hunks.reduce((n, h) => n + h.deletions, 0)
  return p
}
