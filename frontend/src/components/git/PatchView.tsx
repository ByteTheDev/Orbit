import { useMemo } from 'react'
import { highlightLines, languageFor } from '../../lib/highlight'
import { parseUnifiedDiff, splitRows, type DiffRow, type SplitRow } from '../../lib/sourceView'
import { Button } from '../ui'

/** Above this many rows, lines are shown without syntax colour. Highlighting every line of a huge patch costs more than it adds. */
const MAX_HIGHLIGHT_ROWS = 2500

export type PatchMode = 'inline' | 'split'

/**
 * A unified diff, drawn inline or side by side. Added and removed lines carry a tint and a sign, so
 * colour is never the only signal. Code is syntax-coloured by the file's language.
 */
export function PatchView({ text, path, mode, onModeChange }: { text: string; path: string; mode: PatchMode; onModeChange: (m: PatchMode) => void }) {
  const parsed = useMemo(() => parseUnifiedDiff(text), [text])
  const lang = languageFor(path)
  const highlight = parsed.rows.length <= MAX_HIGHLIGHT_ROWS
  const html = useMemo(() => {
    const out = new Map<DiffRow, string>()
    if (!highlight) return out
    for (const r of parsed.rows) {
      if (r.kind === 'hunk' || r.kind === 'meta') continue
      out.set(r, highlightLines(r.text, lang)[0] ?? '')
    }
    return out
  }, [parsed, lang, highlight])

  const content = (r: DiffRow) => (
    <span className="whitespace-pre" dangerouslySetInnerHTML={{ __html: html.get(r) ?? escape(r.text) }} />
  )

  return (
    <div className="min-w-0">
      <div className="mb-2 flex items-center gap-3 font-mono text-label tabular-nums">
        <span className="text-ok">+{parsed.additions}</span>
        <span className="text-danger-soft">−{parsed.deletions}</span>
        <span className="ml-auto flex overflow-hidden rounded-md border border-line" role="group" aria-label="Diff layout">
          {(['inline', 'split'] as PatchMode[]).map((m) => (
            <Button
              key={m}
              size="sm"
              variant="ghost"
              aria-pressed={mode === m}
              onClick={() => onModeChange(m)}
              className={`h-6 rounded-none px-2 text-label ${mode === m ? 'bg-tint/[0.08] text-ink' : 'text-faint'}`}
            >
              {m === 'inline' ? 'Inline' : 'Split'}
            </Button>
          ))}
        </span>
      </div>

      <div className="max-h-[52vh] overflow-auto rounded-md border border-line bg-canvas font-mono text-label leading-[1.55]">
        {mode === 'inline' ? (
          <table className="w-full min-w-max border-collapse">
            <tbody>
              {parsed.rows.map((r, i) => (
                <InlineRow key={i} row={r} content={content(r)} />
              ))}
            </tbody>
          </table>
        ) : (
          <table className="w-full min-w-max border-collapse">
            <tbody>
              {splitRows(parsed.rows).map((row, i) => (
                <SplitLine key={i} row={row} content={content} />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

function rowTone(kind: DiffRow['kind']): string {
  if (kind === 'add') return 'bg-ok/[0.09]'
  if (kind === 'del') return 'bg-danger/[0.09]'
  if (kind === 'hunk') return 'bg-tint/[0.03] text-faint'
  if (kind === 'meta') return 'text-faint'
  return ''
}

function sign(kind: DiffRow['kind']): string {
  if (kind === 'add') return '+'
  if (kind === 'del') return '−'
  return ''
}

function InlineRow({ row, content }: { row: DiffRow; content: React.ReactNode }) {
  if (row.kind === 'hunk' || row.kind === 'meta') {
    return (
      <tr className={rowTone(row.kind)}>
        <td colSpan={4} className="px-3 py-0.5 text-label">
          {row.text}
        </td>
      </tr>
    )
  }
  return (
    <tr className={rowTone(row.kind)}>
      <td className="w-10 select-none pr-2 text-right align-top text-faint/70">{row.oldNo ?? ''}</td>
      <td className="w-10 select-none pr-2 text-right align-top text-faint/70">{row.newNo ?? ''}</td>
      <td className="w-4 select-none text-center align-top text-muted">{sign(row.kind)}</td>
      <td className="pr-3 align-top text-ink/90">{content}</td>
    </tr>
  )
}

function SplitLine({ row, content }: { row: SplitRow; content: (r: DiffRow) => React.ReactNode }) {
  const header = row.left && (row.left.kind === 'hunk' || row.left.kind === 'meta')
  if (header) {
    return (
      <tr className={rowTone(row.left!.kind)}>
        <td colSpan={4} className="px-3 py-0.5">
          {row.left!.text}
        </td>
      </tr>
    )
  }
  return (
    <tr>
      <Half row={row.left} side="left" content={content} />
      <Half row={row.right} side="right" content={content} />
    </tr>
  )
}

function Half({ row, side, content }: { row: DiffRow | null; side: 'left' | 'right'; content: (r: DiffRow) => React.ReactNode }) {
  const border = side === 'left' ? 'border-r border-line' : ''
  if (!row) {
    return (
      <>
        <td className={`w-10 ${border}`} />
        <td className={`min-w-[12rem] ${border} bg-tint/[0.015]`} />
      </>
    )
  }
  const tone = side === 'left' ? (row.kind === 'del' ? 'bg-danger/[0.09]' : '') : row.kind === 'add' ? 'bg-ok/[0.09]' : ''
  const no = side === 'left' ? row.oldNo : row.newNo
  return (
    <>
      <td className={`w-10 select-none pr-2 text-right align-top text-faint/70 ${tone}`}>{no ?? ''}</td>
      <td className={`min-w-[12rem] pr-3 align-top text-ink/90 ${border} ${tone}`}>
        <span className="mr-1.5 select-none text-muted">{row.kind === 'add' || row.kind === 'del' ? sign(row.kind) : ''}</span>
        {content(row)}
      </td>
    </>
  )
}

function escape(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
