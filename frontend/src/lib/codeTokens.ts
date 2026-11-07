// Tokens for code blocks in agent replies. A small, dependency-free tokenizer for the languages
// agents write most. The output is plain data (kind and text), so the view renders it as React text
// and nothing can inject markup. Unknown languages come out as plain text, never an error.

export type TokenKind = 'plain' | 'keyword' | 'string' | 'comment' | 'number' | 'type' | 'fn' | 'punct' | 'add' | 'del' | 'hunk'

export interface Token {
  kind: TokenKind
  text: string
}

interface LangRules {
  keywords: ReadonlySet<string>
  lineComment: '//' | '#' | null
  blockComment: boolean
  /** Template literals: backtick strings that may span lines. */
  backtick: boolean
  /** Diff output is coloured line by line rather than tokenised. */
  diff?: boolean
}

const words = (s: string) => new Set(s.split(/\s+/).filter(Boolean))

const JS = words(
  'break case catch class const continue debugger default delete do else export extends finally for function if import in instanceof let new return super switch this throw try typeof var void while with yield async await of from as type interface enum implements readonly declare abstract public private protected static true false null undefined',
)
const GO = words(
  'break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var true false nil',
)
const PY = words(
  'and as assert async await break class continue def del elif else except finally for from global if import in is lambda None nonlocal not or pass raise return try while with yield True False self',
)
const SHELL = words('if then else elif fi for while do done case esac function in return export local readonly set unset echo cd exit')
const C_LIKE = words(
  'auto break case char class const continue default do double else enum extern float for goto if inline int long namespace new operator private protected public return short signed sizeof static struct switch template this throw try typedef union unsigned using virtual void volatile while bool true false null nil fn let mut pub impl trait use mod match where self Self crate move ref dyn loop var val fun object override final',
)
const JSON_WORDS = words('true false null')
const NONE = new Set<string>()

const JS_RULES: LangRules = { keywords: JS, lineComment: '//', blockComment: true, backtick: true }
const SHELL_RULES: LangRules = { keywords: SHELL, lineComment: '#', blockComment: false, backtick: false }
const C_RULES: LangRules = { keywords: C_LIKE, lineComment: '//', blockComment: true, backtick: false }

const LANGS: Record<string, LangRules> = {
  js: JS_RULES,
  javascript: JS_RULES,
  ts: JS_RULES,
  typescript: JS_RULES,
  tsx: JS_RULES,
  jsx: JS_RULES,
  json: { keywords: JSON_WORDS, lineComment: null, blockComment: false, backtick: false },
  go: { keywords: GO, lineComment: '//', blockComment: true, backtick: true },
  golang: { keywords: GO, lineComment: '//', blockComment: true, backtick: true },
  py: { keywords: PY, lineComment: '#', blockComment: false, backtick: false },
  python: { keywords: PY, lineComment: '#', blockComment: false, backtick: false },
  sh: SHELL_RULES,
  bash: SHELL_RULES,
  shell: SHELL_RULES,
  zsh: SHELL_RULES,
  powershell: { ...SHELL_RULES, blockComment: true },
  ps1: { ...SHELL_RULES, blockComment: true },
  css: { keywords: NONE, lineComment: null, blockComment: true, backtick: false },
  scss: { keywords: NONE, lineComment: '//', blockComment: true, backtick: false },
  c: C_RULES,
  cpp: C_RULES,
  java: C_RULES,
  cs: C_RULES,
  rust: C_RULES,
  rs: C_RULES,
  kotlin: C_RULES,
  swift: C_RULES,
  diff: { keywords: NONE, lineComment: null, blockComment: false, backtick: false, diff: true },
  patch: { keywords: NONE, lineComment: null, blockComment: false, backtick: false, diff: true },
}

const PLAIN: LangRules = { keywords: NONE, lineComment: null, blockComment: false, backtick: false }

/** The rules for a fence label such as `ts`, `TypeScript` or `bash`. Unknown labels get plain rules. */
export function rulesFor(lang: string): LangRules {
  return LANGS[lang.trim().toLowerCase().split(/\s+/)[0] ?? ''] ?? PLAIN
}

/**
 * Tokenises code and groups the tokens by line, so the view can number lines and collapse a block
 * without re-tokenising. Always returns at least one line, even for empty input.
 */
export function tokenizeLines(code: string, lang: string): Token[][] {
  const rules = rulesFor(lang)
  const src = code.replace(/\r\n?/g, '\n')
  if (rules.diff) return src.split('\n').map((line) => [{ kind: diffKind(line), text: line }])
  const lines: Token[][] = [[]]
  for (const t of tokenize(src, rules)) {
    t.text.split('\n').forEach((part, k) => {
      if (k > 0) lines.push([])
      if (part) lines[lines.length - 1].push({ kind: t.kind, text: part })
    })
  }
  return lines
}

/** Same as tokenizeLines. Named for the chat code blocks that import it. */
export const tokenLines = tokenizeLines

function diffKind(line: string): TokenKind {
  if (line.startsWith('@@')) return 'hunk'
  if (line.startsWith('+') && !line.startsWith('+++')) return 'add'
  if (line.startsWith('-') && !line.startsWith('---')) return 'del'
  return 'plain'
}

// Sticky patterns: each matches only at lastIndex, so scanning never copies the rest of the source.
const WORD = /[A-Za-z_$][\w$]*/y
const NUMBER = /(?:0[xX][0-9a-fA-F_]+|\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?)[a-zA-Z]*/y

function tokenize(src: string, rules: LangRules): Token[] {
  const out: Token[] = []
  const push = (kind: TokenKind, text: string) => {
    if (!text) return
    const last = out[out.length - 1]
    // Merge neighbours of the same kind so the rendered DOM stays small.
    if (last && last.kind === kind) last.text += text
    else out.push({ kind, text })
  }
  let pos = 0
  while (pos < src.length) {
    const ch = src[pos]

    if (rules.lineComment && src.startsWith(rules.lineComment, pos)) {
      const end = src.indexOf('\n', pos)
      const stop = end < 0 ? src.length : end
      push('comment', src.slice(pos, stop))
      pos = stop
      continue
    }
    if (rules.blockComment && src.startsWith('/*', pos)) {
      const end = src.indexOf('*/', pos + 2)
      const stop = end < 0 ? src.length : end + 2
      push('comment', src.slice(pos, stop))
      pos = stop
      continue
    }
    if (ch === '"' || ch === "'" || (ch === '`' && rules.backtick)) {
      const stop = stringEnd(src, pos, ch)
      push('string', src.slice(pos, stop))
      pos = stop
      continue
    }

    // A digit that starts a number, not one inside an identifier such as `v2`.
    if (ch >= '0' && ch <= '9' && !isWordChar(src[pos - 1])) {
      NUMBER.lastIndex = pos
      const m = NUMBER.exec(src)
      if (m) {
        push('number', m[0])
        pos += m[0].length
        continue
      }
    }

    if (/[A-Za-z_$]/.test(ch)) {
      WORD.lastIndex = pos
      const word = WORD.exec(src)![0]
      const after = src[pos + word.length]
      let kind: TokenKind = 'plain'
      if (rules.keywords.has(word)) kind = 'keyword'
      else if (after === '(') kind = 'fn'
      else if (/^[A-Z]/.test(word)) kind = 'type'
      push(kind, word)
      pos += word.length
      continue
    }

    // Whitespace and single punctuation characters are the remainder. One character at a time keeps this linear.
    push(/[{}()[\].,;:+\-*%=<>!&|^?~]/.test(ch) ? 'punct' : 'plain', ch)
    pos++
  }
  return out
}

function isWordChar(c: string | undefined): boolean {
  return c !== undefined && /[\w$]/.test(c)
}

/** Index just past a string that starts at `start`. An unterminated string runs to the end of its line. */
function stringEnd(src: string, start: number, quote: string): number {
  let k = start + 1
  while (k < src.length) {
    const c = src[k]
    if (c === '\\') {
      k += 2
      continue
    }
    if (c === quote) return k + 1
    if (c === '\n' && quote !== '`') return k
    k++
  }
  return Math.min(k, src.length)
}
