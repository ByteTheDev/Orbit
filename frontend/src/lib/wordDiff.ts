// Word-level diff for one modified line: which parts of the old and new text changed.
// Pure, so it can be unit-tested. Lines too long to compare cheaply are marked as wholly changed.

export interface Segment {
  text: string
  changed: boolean
}

export interface IntralinePair {
  old: Segment[]
  new: Segment[]
}

/** Tokens are words, runs of spaces, or single punctuation marks. Joined, they give the input back. */
const TOKEN = /\s+|\w+|[^\w\s]/g

/** Past this many token pairs the table gets expensive, so the whole line is marked instead. */
const MAX_CELLS = 250_000

export function intraline(oldText: string, newText: string): IntralinePair {
  if (oldText === newText) {
    return { old: [{ text: oldText, changed: false }], new: [{ text: newText, changed: false }] }
  }
  const a = oldText.match(TOKEN) ?? []
  const b = newText.match(TOKEN) ?? []
  if (a.length === 0 || b.length === 0 || a.length * b.length > MAX_CELLS) {
    return { old: whole(oldText), new: whole(newText) }
  }

  // Longest common subsequence of tokens, computed from the end so the walk below runs forwards.
  const width = b.length + 1
  const table = new Uint32Array((a.length + 1) * width)
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i * width + j] =
        a[i] === b[j] ? table[(i + 1) * width + j + 1] + 1 : Math.max(table[(i + 1) * width + j], table[i * width + j + 1])
    }
  }

  const oldSegs: Segment[] = []
  const newSegs: Segment[] = []
  let i = 0
  let j = 0
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      push(oldSegs, a[i], false)
      push(newSegs, b[j], false)
      i++
      j++
    } else if (j >= b.length || (i < a.length && table[(i + 1) * width + j] >= table[i * width + j + 1])) {
      push(oldSegs, a[i], true)
      i++
    } else {
      push(newSegs, b[j], true)
      j++
    }
  }
  return { old: oldSegs, new: newSegs }
}

function whole(text: string): Segment[] {
  return text ? [{ text, changed: true }] : []
}

/** Appends a token, merging it into the previous segment when the change flag matches. */
function push(segs: Segment[], text: string, changed: boolean) {
  const last = segs[segs.length - 1]
  if (last && last.changed === changed) last.text += text
  else segs.push({ text, changed })
}

/** Per-character flags for a line, so highlighting can mark the changed characters. */
export function changedFlags(segs: Segment[]): boolean[] {
  const flags: boolean[] = []
  for (const s of segs) for (let k = 0; k < s.text.length; k++) flags.push(s.changed)
  return flags
}
