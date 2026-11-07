// A small, safe Markdown subset for agent replies. Pure: no React, no HTML. Output is plain data,
// so the view decides how each piece looks and nothing can inject markup.

export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'bold'; text: string }
  | { kind: 'italic'; text: string }
  | { kind: 'strike'; text: string }
  /** Only http and https links survive parsing. Anything else stays as plain text. */
  | { kind: 'link'; text: string; href: string }

export type Align = 'left' | 'center' | 'right' | null

export type Block =
  | { kind: 'paragraph'; lines: string[] }
  | { kind: 'heading'; level: 1 | 2 | 3; text: string }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'quote'; lines: string[] }
  | { kind: 'code'; lang: string; text: string }
  | { kind: 'table'; header: string[]; align: Align[]; rows: string[][] }
  | { kind: 'rule' }

const FENCE = /^\s*```(.*)$/
const HEADING = /^(#{1,3})\s+(.*\S)\s*$/
const BULLET = /^\s*[-*+]\s+(.*)$/
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/
const QUOTE = /^\s*>\s?(.*)$/
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/
/** A table separator row such as `| --- | :---: |`. */
const TABLE_RULE = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/

/** Splits a reply into blocks. An unterminated fence runs to the end, as streamed replies often do. */
export function parseBlocks(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n')
  const blocks: Block[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    if (line.trim() === '') {
      i++
      continue
    }

    const fence = FENCE.exec(line)
    if (fence) {
      const body: string[] = []
      i++
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) {
        body.push(lines[i])
        i++
      }
      i++ // skip the closing fence, if there is one
      blocks.push({ kind: 'code', lang: fence[1].trim(), text: body.join('\n') })
      continue
    }

    const heading = HEADING.exec(line)
    if (heading) {
      blocks.push({ kind: 'heading', level: heading[1].length as 1 | 2 | 3, text: heading[2] })
      i++
      continue
    }

    if (RULE.test(line)) {
      blocks.push({ kind: 'rule' })
      i++
      continue
    }

    // A table is a header row, a separator row, then any rows containing a pipe.
    const table = tableAt(lines, i)
    if (table) {
      const rows: string[][] = []
      i += 2
      while (i < lines.length && lines[i].trim() !== '' && lines[i].includes('|')) {
        rows.push(splitRow(lines[i]))
        i++
      }
      blocks.push({ kind: 'table', header: table.header, align: table.align, rows })
      continue
    }

    const bullet = BULLET.exec(line)
    const numbered = NUMBERED.exec(line)
    if (bullet || numbered) {
      const ordered = !bullet
      const re = ordered ? NUMBERED : BULLET
      const items: string[] = []
      while (i < lines.length) {
        const m = re.exec(lines[i])
        if (!m) break
        items.push(m[1])
        i++
      }
      blocks.push({ kind: 'list', ordered, items })
      continue
    }

    if (QUOTE.test(line)) {
      const quoted: string[] = []
      while (i < lines.length && QUOTE.test(lines[i])) {
        quoted.push(QUOTE.exec(lines[i])![1])
        i++
      }
      blocks.push({ kind: 'quote', lines: quoted })
      continue
    }

    // Paragraph: consecutive lines until a blank line or the start of another block.
    // Paragraph: consecutive lines until a blank line or the start of another block. The first line
    // is always taken, so a line no branch above claims can never stall the loop.
    const para: string[] = [lines[i]]
    i++
    while (i < lines.length && lines[i].trim() !== '' && !startsBlock(lines, i)) {
      para.push(lines[i])
      i++
    }
    blocks.push({ kind: 'paragraph', lines: para })
  }

  return blocks
}

function startsBlock(lines: string[], index: number): boolean {
  const line = lines[index]
  return (
    FENCE.test(line) ||
    HEADING.test(line) ||
    BULLET.test(line) ||
    NUMBERED.test(line) ||
    QUOTE.test(line) ||
    RULE.test(line) ||
    tableAt(lines, index) !== null
  )
}

/**
 * A table starting at `index`: a header row and a separator row with the same column count.
 * Null otherwise, so a stray pipe in ordinary text stays a paragraph.
 */
function tableAt(lines: string[], index: number): { header: string[]; align: Align[] } | null {
  const head = lines[index]
  const rule = lines[index + 1]
  if (rule === undefined || !head.includes('|') || !rule.includes('|') || !TABLE_RULE.test(rule)) return null
  const header = splitRow(head)
  const align = splitRow(rule).map(alignOf)
  return header.length === align.length ? { header, align } : null
}

/** Cells of one table row. Leading and trailing pipes are optional, and `\|` is a literal pipe. */
function splitRow(line: string): string[] {
  let s = line.trim()
  if (s.startsWith('|')) s = s.slice(1)
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1)
  const cells: string[] = []
  let cur = ''
  for (let k = 0; k < s.length; k++) {
    if (s[k] === '\\' && s[k + 1] === '|') {
      cur += '|'
      k++
    } else if (s[k] === '|') {
      cells.push(cur.trim())
      cur = ''
    } else {
      cur += s[k]
    }
  }
  cells.push(cur.trim())
  return cells
}

function alignOf(cell: string): Align {
  const left = cell.startsWith(':')
  const right = cell.endsWith(':')
  if (left && right) return 'center'
  if (right) return 'right'
  if (left) return 'left'
  return null
}

// Order matters: code first so its contents are never styled, then links, then bold before italic
// so ** is not read as *. Strikethrough and bold share no characters, so they can sit anywhere after code.
const INLINE =
  /(`[^`\n]+`)|(\[[^\]\n]+\]\(https?:\/\/[^\s)]+\))|(~~(?=\S)[^\n]*?\S~~)|(\*\*(?=\S)[^\n]*?\S\*\*)|(__(?=\S)[^\n]*?\S__)|(\*(?![\s*])[^*\n]*?[^\s*]\*)/g

/** Splits one line of text into styled runs. Unmatched markers are kept as plain text. */
export function parseInline(text: string): Inline[] {
  const out: Inline[] = []
  let last = 0
  for (const m of text.matchAll(INLINE)) {
    const at = m.index ?? 0
    if (at > last) out.push({ kind: 'text', text: text.slice(last, at) })
    const raw = m[0]
    if (raw.startsWith('`')) {
      out.push({ kind: 'code', text: raw.slice(1, -1) })
    } else if (raw.startsWith('[')) {
      const close = raw.indexOf('](')
      out.push({ kind: 'link', text: raw.slice(1, close), href: raw.slice(close + 2, -1) })
    } else if (raw.startsWith('~~')) {
      out.push({ kind: 'strike', text: raw.slice(2, -2) })
    } else if (raw.startsWith('**') || raw.startsWith('__')) {
      out.push({ kind: 'bold', text: raw.slice(2, -2) })
    } else {
      out.push({ kind: 'italic', text: raw.slice(1, -1) })
    }
    last = at + raw.length
  }
  if (last < text.length) out.push({ kind: 'text', text: text.slice(last) })
  return out
}
