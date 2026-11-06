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
