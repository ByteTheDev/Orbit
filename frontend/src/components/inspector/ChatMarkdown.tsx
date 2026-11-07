// Rendering for agent replies: Markdown blocks, highlighted code, tables, and the copy actions.
// Everything becomes React elements, never HTML, so a reply cannot inject markup.
import { Fragment, memo, useEffect, useMemo, useState, type ReactNode } from 'react'
import { openInSystemBrowser } from '../../lib/actions'
import { tokenLines, type TokenKind } from '../../lib/codeTokens'
import { parseBlocks, parseInline, type Align, type Block } from '../../lib/markdown'
import { toast } from '../../lib/store'
import { IconCheck } from '../ui'
import { IconCopy, IconLineNumbers } from './inspectorIcons'

/** Code blocks longer than this many lines show their first lines until expanded. */
const COLLAPSE_LINES = 14

/** Copies text. Reports the outcome as a toast, so every caller behaves the same. Resolves to whether it worked. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    toast('Could not copy to the clipboard', 'error')
    return false
  }
}

/** A quiet copy button. It shows a check for a moment after copying, so the result is visible without a toast. */
export function CopyButton({ text, label, className = '' }: { text: string; label: string; className?: string }) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const id = window.setTimeout(() => setCopied(false), 1500)
    return () => window.clearTimeout(id)
  }, [copied])
  return (
    <button
      type="button"
      onClick={async () => {
        if (await copyText(text)) setCopied(true)
      }}
      aria-label={label}
      title={label}
      className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-label text-faint transition-colors duration-150 hover:bg-tint/[0.05] hover:text-ink focus-visible:text-ink ${className}`}
    >
      {copied ? <IconCheck size={12} aria-hidden="true" /> : <IconCopy size={12} aria-hidden="true" />}
      <span>{copied ? 'Copied' : 'Copy'}</span>
    </button>
  )
}

/**
 * Renders the Markdown subset agent replies use (see lib/markdown.ts). Memoised on the text, so a
 * reply that has not changed is never parsed again.
 */
export const Markdownish = memo(function Markdownish({ text }: { text: string }) {
  const blocks = useMemo(() => parseBlocks(text), [text])
  return (
    <div className="space-y-3">
      {blocks.map((b, i) => (
        <BlockView key={i} block={b} />
      ))}
    </div>
  )
})

function BlockView({ block: b }: { block: Block }) {
  switch (b.kind) {
    case 'heading': {
      const cls = b.level === 1 ? 'text-title font-semibold' : b.level === 2 ? 'text-body font-semibold' : 'text-body font-medium text-muted'
      return <p className={`${cls} pt-1 text-ink`}>{inline(b.text)}</p>
    }
    case 'list': {
      const Tag = b.ordered ? 'ol' : 'ul'
      return (
        <Tag className={`space-y-1 pl-5 marker:text-faint ${b.ordered ? 'list-decimal' : 'list-disc'}`}>
          {b.items.map((item, i) => (
            <li key={i} className="pl-1 leading-relaxed">
              {inline(item)}
            </li>
          ))}
        </Tag>
      )
    }
    case 'quote':
      return (
        <blockquote className="space-y-1 border-l-2 border-line-strong pl-3 text-muted">
          {b.lines.map((l, i) => (
            <p key={i}>{inline(l)}</p>
          ))}
        </blockquote>
      )
    case 'code':
      return <CodeBlockView lang={b.lang} text={b.text} />
    case 'table':
      return <TableView header={b.header} align={b.align} rows={b.rows} />
    case 'rule':
      return <hr className="my-1 border-line" />
    case 'paragraph':
      return (
        <p className="leading-relaxed">
          {b.lines.map((line, i) => (
            <Fragment key={i}>
              {i > 0 && <br />}
              {inline(line)}
            </Fragment>
          ))}
        </p>
      )
  }
}

function alignClass(a: Align): string {
  if (a === 'center') return 'text-center'
  if (a === 'right') return 'text-right'
  return 'text-left'
}

function TableView({ header, align, rows }: { header: string[]; align: Align[]; rows: string[][] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-line">
      <table className="w-full border-collapse text-caption">
        <thead>
          <tr className="bg-tint/[0.03]">
            {header.map((h, i) => (
              <th key={i} scope="col" className={`border-b border-line px-3 py-1.5 font-medium text-ink ${alignClass(align[i])}`}>
                {inline(h)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            <tr key={r} className="border-t border-line first:border-t-0">
              {header.map((_, c) => (
                <td key={c} className={`px-3 py-1.5 align-top leading-relaxed text-ink/90 ${alignClass(align[c])}`}>
                  {inline(row[c] ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Colour for each token kind. Muted hues on the dark canvas; comments and punctuation stay quiet. */
const TOKEN_CLASS: Record<TokenKind, string> = {
  plain: '',
  keyword: 'text-[#c4a7ff]',
  string: 'text-[#a7d28b]',
  comment: 'italic text-faint',
  number: 'text-[#f0b98a]',
  type: 'text-[#8fd8f5]',
  fn: 'text-[#9cc4ff]',
  punct: 'text-muted',
  add: 'bg-ok/[0.08] text-ok',
  del: 'bg-danger/[0.08] text-danger-soft',
  hunk: 'text-faint',
}

/**
 * A fenced code block: language label, line count, copy, optional line numbers, and collapsing for
 * long blocks. Highlighting is skipped for unknown languages, which then show as plain monospace.
 */
export function CodeBlockView({ lang, text }: { lang: string; text: string }) {
  const [numbers, setNumbers] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const lines = useMemo(() => tokenLines(text, lang), [text, lang])
  const long = lines.length > COLLAPSE_LINES
  const shown = long && !expanded ? lines.slice(0, COLLAPSE_LINES) : lines
  const label = lang.trim() || 'text'
  const count = `${lines.length} ${lines.length === 1 ? 'line' : 'lines'}`

  return (
    <div className="overflow-hidden rounded-lg border border-line bg-canvas">
      <div className="flex items-center gap-2 border-b border-line px-3 py-1.5 text-label text-faint">
        <span className="truncate font-mono uppercase tracking-[0.08em]">{label}</span>
        <span className="shrink-0 tabular-nums">{count}</span>
        <span className="ml-auto flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            onClick={() => setNumbers((n) => !n)}
            aria-pressed={numbers}
            aria-label="Show line numbers"
            title="Line numbers"
            className={`flex h-5 w-5 items-center justify-center rounded transition-colors duration-150 hover:bg-tint/[0.05] hover:text-ink ${numbers ? 'text-ink' : ''}`}
          >
            <IconLineNumbers size={12} aria-hidden="true" />
          </button>
          <CopyButton text={text} label="Copy code" />
        </span>
      </div>
      <pre className="overflow-x-auto p-3 font-mono text-caption leading-relaxed text-ink/85">
        <code>
          {shown.map((line, i) => (
            <div key={i} className="flex min-h-[1lh]">
              {numbers && (
                <span aria-hidden="true" className="w-8 shrink-0 select-none pr-3 text-right tabular-nums text-faint">
                  {i + 1}
                </span>
              )}
              <span className="min-w-0 whitespace-pre">
                {line.map((t, k) => (
                  <span key={k} className={TOKEN_CLASS[t.kind]}>
                    {t.text}
                  </span>
                ))}
              </span>
            </div>
          ))}
        </code>
      </pre>
      {long && (
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          aria-expanded={expanded}
          className="w-full border-t border-line px-3 py-1 text-left text-label text-faint transition-colors duration-150 hover:bg-tint/[0.03] hover:text-ink"
        >
          {expanded ? 'Show less' : `Show all ${lines.length} lines`}
        </button>
      )}
    </div>
  )
}

/** Inline runs. Links open in the system browser, and only http and https links exist (see lib/markdown.ts). */
function inline(text: string): ReactNode[] {
  return parseInline(text).map((run, i) => {
    switch (run.kind) {
      case 'code':
        return (
          <code key={i} className="rounded bg-tint/[0.07] px-1 py-px font-mono text-caption text-ink">
            {run.text}
          </code>
        )
      case 'bold':
        return (
          <strong key={i} className="font-semibold text-ink">
            {run.text}
          </strong>
        )
      case 'italic':
        return <em key={i}>{run.text}</em>
      case 'strike':
        return (
          <del key={i} className="text-faint">
            {run.text}
          </del>
        )
      case 'link':
        return (
          <a
            key={i}
            href={run.href}
            title={run.href}
            onClick={(e) => {
              e.preventDefault()
              void openInSystemBrowser(run.href)
            }}
            className="text-ink underline decoration-faint underline-offset-[3px] transition-colors duration-150 hover:decoration-ink"
          >
            {run.text}
          </a>
        )
      default:
        return <Fragment key={i}>{run.text}</Fragment>
    }
  })
}
