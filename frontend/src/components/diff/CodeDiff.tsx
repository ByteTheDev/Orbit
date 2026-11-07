import { useEffect, useLayoutEffect, useMemo, useRef, useState, type UIEvent } from 'react'
import { copyText } from '../../lib/actions'
import { contentAsPatch, parsePatch, type DiffLine } from '../../lib/diff'
import { buildLayout, type Cell, type Row } from '../../lib/diffLayout'
import { highlightPatch, lineHtml } from '../../lib/highlight'
import { EmptyState, MaterialIcon, Select } from '../ui'

/** What the text is: a git diff, an agent's recorded edit, or a whole file with nothing changed. */
export type DiffKind = 'git' | 'edit' | 'file'

const ROW = 20
const OVERSCAN = 14
/** Width of one line-number column, in pixels. */
const NUM = 44
/** Width of the +/- column, in pixels. */
const SIGN = 16
/** Padding around the code of one side, in pixels. */
const CODE_PAD = 12

const KIND_LABEL: Record<DiffKind, string> = {
  git: 'Working tree against HEAD',
  edit: 'Recorded agent edit, no line numbers',
  file: 'File content',
}

interface CodeDiffProps {
  text: string
  path: string
  kind: DiffKind
  emptyTitle: string
  emptyBody: string
}

/**
 * A code diff that stays fast on big files: only the visible rows are drawn, unchanged context is
 * folded, and long lines scroll sideways inside the viewer. Unified and side-by-side are both offered.
 */
export function CodeDiff({ text, path, kind, emptyTitle, emptyBody }: CodeDiffProps) {
  const [split, setSplit] = useState(false)
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())
  const [current, setCurrent] = useState(-1)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewport, setViewport] = useState(0)
  const scrollRef = useRef<HTMLDivElement>(null)

  const patch = useMemo(() => {
    const p = kind === 'file' ? contentAsPatch(text) : parsePatch(text)
    highlightPatch(p, path)
    return p
  }, [text, path, kind])

  const layout = useMemo(
    () => buildLayout(patch, { split, expanded, fold: kind !== 'file' }),
    [patch, split, expanded, kind],
  )
  const { rows, changes, hunks, folds, maxChars } = layout

  // A new diff starts at the top, with nothing expanded and no change selected.
  useEffect(() => {
    setExpanded(new Set())
    setCurrent(-1)
    if (scrollRef.current) scrollRef.current.scrollTop = 0
    setScrollTop(0)
  }, [text, path, kind])

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const measure = () => setViewport(el.clientHeight)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const first = Math.max(0, Math.floor(scrollTop / ROW) - OVERSCAN)
  const last = Math.min(rows.length, Math.ceil((scrollTop + viewport) / ROW) + OVERSCAN)

  // Long lines set the width, and rows always fill at least the viewer, so tints run edge to edge.
  // Monospace characters make "ch" an exact measure of a line.
  const contentWidth = split
    ? `${maxChars * 2}ch + ${2 * (NUM + SIGN + CODE_PAD)}px`
    : `${maxChars}ch + ${2 * NUM + SIGN + CODE_PAD * 2}px`
  const width = `max(100%, calc(${contentWidth}))`

  const scrollTo = (row: number) => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = Math.max(0, row * ROW - ROW * 3)
    setScrollTop(el.scrollTop)
  }

  const step = (to: number) => {
    const n = changes.length
    if (n === 0) return
    const k = ((to % n) + n) % n
    setCurrent(k)
    scrollTo(changes[k])
  }

  const toggleFold = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const onScroll = (e: UIEvent<HTMLDivElement>) => setScrollTop(e.currentTarget.scrollTop)

  if (patch.hunks.length === 0) {
    return <EmptyState icon={<MaterialIcon outlined name="difference" size={28} />} title={emptyTitle} body={emptyBody} />
  }

  const additions = patch.additions
  const deletions = patch.deletions

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-2.5 py-1.5 text-caption">
        <span className="min-w-0 truncate text-muted" title={KIND_LABEL[kind]}>
          {KIND_LABEL[kind]}
        </span>
        <span className="font-mono text-label tabular-nums">
          <span className="text-ok">+{additions}</span> <span className="text-danger-soft">−{deletions}</span>
        </span>
        <div className="ml-auto flex items-center gap-0.5">
          {hunks.length > 1 && (
            <Select
              aria-label="Jump to a hunk"
              compact
              value=""
              onChange={(e) => {
                const i = Number(e.target.value)
                if (Number.isFinite(i) && e.target.value !== '') scrollTo(hunks[i].row)
              }}
              className="mr-1 max-w-[12rem]"
            >
              <option value="">Jump to hunk</option>
              {hunks.map((h, i) => (
                <option key={i} value={String(i)}>
                  {`${h.label} · +${h.additions} −${h.deletions}`}
                </option>
              ))}
            </Select>
          )}
          <IconToggle label="Previous change" disabled={changes.length === 0} onClick={() => step(current <= 0 ? changes.length - 1 : current - 1)} icon="arrow_upward" />
          <span className="min-w-[3.25rem] text-center font-mono text-label tabular-nums text-faint">
            {changes.length === 0 ? 'No changes' : current < 0 ? `${changes.length}` : `${current + 1} / ${changes.length}`}
          </span>
          <IconToggle label="Next change" disabled={changes.length === 0} onClick={() => step(current + 1)} icon="arrow_downward" />
          {kind !== 'file' && folds.length > 0 && (
            <IconToggle
              label={expanded.size > 0 ? 'Fold unchanged lines' : 'Show all unchanged lines'}
              onClick={() => setExpanded(expanded.size > 0 ? new Set() : new Set(folds))}
              icon={expanded.size > 0 ? 'unfold_less' : 'unfold_more'}
            />
          )}
          <span className="mx-1 h-4 w-px bg-line" aria-hidden="true" />
          <IconToggle label="Unified view" active={!split} onClick={() => setSplit(false)} icon="view_stream" />
          <IconToggle label="Side by side" active={split} onClick={() => setSplit(true)} icon="vertical_split" />
        </div>
      </div>

      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="diff-code relative min-h-0 flex-1 overflow-auto bg-canvas font-mono text-caption"
        style={{ tabSize: 4 }}
      >
        <div style={{ height: rows.length * ROW, width, position: 'relative' }}>
          {rows.slice(first, last).map((row, k) => {
            const i = first + k
            return (
              <div key={i} className="absolute left-0" style={{ top: i * ROW, height: ROW, width }}>
                {renderRow(row, split, toggleFold)}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function renderRow(row: Row, split: boolean, toggleFold: (key: string) => void) {
  switch (row.type) {
    case 'hunk':
      return (
        <div className="group flex h-full items-center gap-2 bg-tint/[0.03] px-3 leading-5 text-faint">
          <span className="whitespace-nowrap text-muted">{row.header || row.title}</span>
          {row.header && row.title && <span className="whitespace-nowrap text-faint">{row.title}</span>}
          <span className="font-mono text-label tabular-nums">
            <span className="text-ok/80">+{row.additions}</span> <span className="text-danger-soft/80">−{row.deletions}</span>
          </span>
          <button
            type="button"
            onClick={() => void copyText(row.patch, 'Hunk')}
            aria-label="Copy hunk"
            title="Copy hunk as a patch"
            className="ml-1 inline-flex h-4 items-center gap-1 rounded px-1 text-label text-faint opacity-0 transition-[opacity,color] duration-150 hover:text-ink focus-visible:opacity-100 group-hover:opacity-100"
          >
            <MaterialIcon outlined name="content_copy" size={11} />
            Copy
          </button>
        </div>
      )
    case 'fold':
      return (
        <button
          type="button"
          onClick={() => toggleFold(row.key)}
          className="flex h-full w-full items-center gap-2 px-3 leading-5 text-faint transition-colors duration-150 hover:bg-tint/[0.03] hover:text-muted"
        >
          <MaterialIcon outlined name={row.expanded ? 'unfold_less' : 'unfold_more'} size={13} />
          {row.expanded ? `Hide ${row.count} unchanged lines` : `Show ${row.count} unchanged lines`}
        </button>
      )
    case 'line': {
      const html = lineHtml(row.line, row.segs)
      return (
        <div className={`flex h-full items-stretch ${rowTone(row.line.kind)}`}>
          <Num value={row.line.oldNo} />
          <Num value={row.line.newNo} />
          <Sign kind={row.line.kind} />
          <span className="whitespace-pre pl-3 pr-6 leading-5" dangerouslySetInnerHTML={{ __html: html }} />
        </div>
      )
    }
    case 'pair':
      if (!split) return null
      return (
        <div className="flex h-full items-stretch">
          <Half cell={row.left} side="left" />
          <Half cell={row.right} side="right" />
        </div>
      )
  }
}

function Half({ cell, side }: { cell: Cell | null; side: 'left' | 'right' }) {
  const border = side === 'right' ? 'border-l border-line' : ''
  if (!cell) return <div className={`h-full w-1/2 bg-tint/[0.012] ${border}`} />
  const { line, segs } = cell
  const number = side === 'left' ? line.oldNo : line.newNo
  return (
    <div className={`flex h-full w-1/2 items-stretch ${rowTone(line.kind)} ${border}`}>
      <Num value={number} />
      <Sign kind={line.kind} />
      <span className="whitespace-pre pl-3 pr-4 leading-5" dangerouslySetInnerHTML={{ __html: lineHtml(line, segs) }} />
    </div>
  )
}

function Num({ value }: { value: number | null }) {
  return <span className="w-11 shrink-0 select-none pr-2 text-right leading-5 tabular-nums text-faint/70">{value ?? ''}</span>
}

function Sign({ kind }: { kind: DiffLine['kind'] }) {
  const sign = kind === 'add' ? '+' : kind === 'del' ? '−' : ''
  const tone = kind === 'add' ? 'text-ok' : kind === 'del' ? 'text-danger-soft' : 'text-faint'
  return <span className={`w-4 shrink-0 select-none text-center leading-5 ${tone}`}>{sign}</span>
}

function rowTone(kind: DiffLine['kind']): string {
  if (kind === 'add') return 'diff-row-add bg-ok/[0.08] transition-colors duration-150 hover:bg-ok/[0.12]'
  if (kind === 'del') return 'diff-row-del bg-danger/[0.08] transition-colors duration-150 hover:bg-danger/[0.12]'
  return 'transition-colors duration-150 hover:bg-tint/[0.025]'
}

function IconToggle({
  label,
  icon,
  onClick,
  active = false,
  disabled = false,
}: {
  label: string
  icon: string
  onClick: () => void
  active?: boolean
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex h-6 w-6 items-center justify-center rounded-md transition-colors duration-150 disabled:pointer-events-none disabled:opacity-40 ${
        active ? 'bg-tint/[0.08] text-ink' : 'text-faint hover:bg-tint/[0.05] hover:text-ink'
      }`}
    >
      <MaterialIcon outlined name={icon} size={15} />
    </button>
  )
}
