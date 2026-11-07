// Syntax highlighting for diff lines. highlight.js does the tokens; this module splits its
// output into one HTML string per line, so each diff row can be rendered and virtualised alone.
import hljs from 'highlight.js/lib/core'
import bash from 'highlight.js/lib/languages/bash'
import c from 'highlight.js/lib/languages/c'
import cpp from 'highlight.js/lib/languages/cpp'
import csharp from 'highlight.js/lib/languages/csharp'
import css from 'highlight.js/lib/languages/css'
import go from 'highlight.js/lib/languages/go'
import ini from 'highlight.js/lib/languages/ini'
import java from 'highlight.js/lib/languages/java'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import lua from 'highlight.js/lib/languages/lua'
import markdown from 'highlight.js/lib/languages/markdown'
import powershell from 'highlight.js/lib/languages/powershell'
import python from 'highlight.js/lib/languages/python'
import rust from 'highlight.js/lib/languages/rust'
import sql from 'highlight.js/lib/languages/sql'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'
import yaml from 'highlight.js/lib/languages/yaml'
import type { DiffLine, ParsedPatch } from './diff'
import type { Segment } from './wordDiff'

const LANGUAGES: Record<string, Parameters<typeof hljs.registerLanguage>[1]> = {
  bash, c, cpp, csharp, css, go, ini, java, javascript, json, lua, markdown,
  powershell, python, rust, sql, typescript, xml, yaml,
}
for (const [name, grammar] of Object.entries(LANGUAGES)) hljs.registerLanguage(name, grammar)

const EXTENSIONS: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  json: 'json', css: 'css', html: 'xml', htm: 'xml', xml: 'xml', svg: 'xml', vue: 'xml',
  go: 'go', py: 'python', rs: 'rust', java: 'java', cs: 'csharp',
  c: 'c', h: 'c', cc: 'cpp', cpp: 'cpp', cxx: 'cpp', hpp: 'cpp', hh: 'cpp',
  sh: 'bash', bash: 'bash', zsh: 'bash', ps1: 'powershell',
  yml: 'yaml', yaml: 'yaml', md: 'markdown', markdown: 'markdown',
  sql: 'sql', toml: 'ini', ini: 'ini', cfg: 'ini', lua: 'lua', luau: 'lua',
}

/** Longest input that is highlighted. Beyond it the text is shown plain, which keeps huge files responsive. */
const MAX_HIGHLIGHT_CHARS = 300_000

/** The highlight.js language for a file name, or null when the file gets plain text. */
export function languageFor(path: string): string | null {
  const dot = path.lastIndexOf('.')
  if (dot < 0) return null
  return EXTENSIONS[path.slice(dot + 1).toLowerCase()] ?? null
}

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => ESCAPES[ch])
}
const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

/** One highlighted HTML string per line of code. Plain, escaped text when no language applies. */
export function highlightLines(code: string, language: string | null): string[] {
  if (!language || code.length > MAX_HIGHLIGHT_CHARS) return code.split('\n').map(escapeHtml)
  const html = hljs.highlight(code, { language, ignoreIllegals: true }).value
  return splitHighlighted(html)
}

/**
 * Splits highlighted HTML at its newlines. A token that spans lines (a block comment, say) is
 * closed at the end of each line and reopened on the next, so every line is valid on its own.
 */
export function splitHighlighted(html: string): string[] {
  const lines: string[] = []
  const open: string[] = []
  let current = ''
  const tokens = html.match(/<[^>]+>|[^<]+/g) ?? []
  for (const tok of tokens) {
    if (tok.startsWith('</')) {
      open.pop()
      current += tok
    } else if (tok.startsWith('<')) {
      open.push(tok)
      current += tok
    } else {
      const parts = tok.split('\n')
      parts.forEach((part, i) => {
        if (i > 0) {
          lines.push(current + '</span>'.repeat(open.length))
          current = open.join('')
        }
        current += part
      })
    }
  }
  lines.push(current + '</span>'.repeat(open.length))
  return lines
}

/**
 * Wraps the characters flagged as changed in <mark>, leaving the existing markup alone. The flags
 * index the line's plain text, one per UTF-16 unit, so an HTML entity counts as the one character it stands for.
 */
export function markChanged(html: string, flags: boolean[]): string {
  let out = ''
  let k = 0
  let inMark = false
  let i = 0
  while (i < html.length) {
    if (html[i] === '<') {
      const end = html.indexOf('>', i)
      const tag = end < 0 ? html.slice(i) : html.slice(i, end + 1)
      if (inMark) {
        out += '</mark>'
        inMark = false
      }
      out += tag
      i += tag.length
      continue
    }
    let unit: string
    if (html[i] === '&') {
      const m = /^&(?:#\d+|#x[0-9a-fA-F]+|\w+);/.exec(html.slice(i, i + 12))
      unit = m ? m[0] : '&'
    } else {
      unit = html[i]
    }
    const changed = flags[k] === true
    if (changed && !inMark) {
      out += '<mark class="diff-word">'
      inMark = true
    } else if (!changed && inMark) {
      out += '</mark>'
      inMark = false
    }
    out += unit
    i += unit.length
    k++
  }
  if (inMark) out += '</mark>'
  return out
}

/** Gives every line of a patch its highlighted HTML, in place. */
export function highlightPatch(patch: ParsedPatch, path: string): void {
  const language = languageFor(path)
  for (const hunk of patch.hunks) {
    // Highlight each side as one block, so a multi-line token keeps its state across lines.
    const oldSide = hunk.lines.filter((l) => l.kind !== 'add')
    const newSide = hunk.lines.filter((l) => l.kind !== 'del')
    const oldHtml = highlightLines(oldSide.map((l) => l.text).join('\n'), language)
    const newHtml = highlightLines(newSide.map((l) => l.text).join('\n'), language)
    oldSide.forEach((l, i) => (l.html = oldHtml[i]))
    newSide.forEach((l, i) => {
      // Context lines already have their old-side HTML, which is identical for the same text.
      if (l.kind === 'add' || l.html === undefined) l.html = newHtml[i]
    })
  }
}

/** A line's HTML with its changed characters marked, given the segments of its word diff. */
export function lineHtml(line: DiffLine, segs: Segment[] | null): string {
  const base = line.html ?? escapeHtml(line.text)
  if (!segs || !segs.some((s) => s.changed)) return base
  const flags: boolean[] = []
  for (const s of segs) for (let k = 0; k < s.text.length; k++) flags.push(s.changed)
  return markChanged(base, flags)
}
