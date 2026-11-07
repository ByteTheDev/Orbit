// A small, safe Markdown subset for agent replies. Pure: no React, no HTML. Output is plain data,
// so the view decides how each piece looks and nothing can inject markup.

export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'bold'; text: string }
  | { kind: 'italic'; text: string }

export type Block =
  | { kind: 'paragraph'; lines: string[] }
  | { kind: 'heading'; level: 1 | 2 | 3; text: string }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'quote'; lines: string[] }
  | { kind: 'code'; lang: string; text: string }

const FENCE = /^\s*```(.*)$/
const HEADING = /^(#{1,3})\s+(.*\S)\s*$/
const BULLET = /^\s*[-*+]\s+(.*)$/
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/
const QUOTE = /^\s*>\s?(.*)$/

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
    const para: string[] = []
    while (i < lines.length && lines[i].trim() !== '' && !startsBlock(lines[i])) {
      para.push(lines[i])
      i++
    }
    blocks.push({ kind: 'paragraph', lines: para })
  }

  return blocks
}

function startsBlock(line: string): boolean {
  return FENCE.test(line) || HEADING.test(line) || BULLET.test(line) || NUMBERED.test(line) || QUOTE.test(line)
}

// Order matters: code first so its contents are never styled, then bold before italic so ** is not read as *.
const INLINE = /(`[^`\n]+`)|(\*\*(?=\S)[^\n]*?\S\*\*)|(__(?=\S)[^\n]*?\S__)|(\*(?![\s*])[^*\n]*?[^\s*]\*)/g

/** Splits one line of text into styled runs. Unmatched markers are kept as plain text. */
export function parseInline(text: string): Inline[] {
  const out: Inline[] = []
  let last = 0
  for (const m of text.matchAll(INLINE)) {
    const at = m.index ?? 0
    if (at > last) out.push({ kind: 'text', text: text.slice(last, at) })
    const raw = m[0]
    if (raw.startsWith('`')) out.push({ kind: 'code', text: raw.slice(1, -1) })
    else if (raw.startsWith('**') || raw.startsWith('__')) out.push({ kind: 'bold', text: raw.slice(2, -2) })
    else out.push({ kind: 'italic', text: raw.slice(1, -1) })
    last = at + raw.length
  }
  if (last < text.length) out.push({ kind: 'text', text: text.slice(last) })
  return out
}
