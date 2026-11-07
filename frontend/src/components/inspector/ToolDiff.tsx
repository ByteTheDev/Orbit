// The change an edit tool made, shown as removed and added lines. Line-level, not a full diff:
// it shows exactly what the agent sent, which is what a reader needs to check it.
import { Fragment } from 'react'
import type { EditPreview } from '../../lib/toolEdit'
import { baseName } from '../../lib/format'

export function ToolDiff({ preview }: { preview: EditPreview }) {
  return (
    <div className="overflow-hidden rounded-lg border border-line bg-canvas">
      {preview.path && (
        <div className="truncate border-b border-line px-3 py-1.5 font-mono text-label text-muted" title={preview.path}>
          {baseName(preview.path)}
          <span className="ml-2 text-faint">{preview.path}</span>
        </div>
      )}
      <pre className="max-h-64 overflow-auto p-2 font-mono text-caption leading-relaxed">
        {preview.hunks.map((h, i) => (
          <Fragment key={i}>
            {h.before && <Lines text={h.before} sign="-" className="bg-danger/[0.08] text-danger-soft" />}
            {h.after && <Lines text={h.after} sign="+" className="bg-ok/[0.08] text-ok" />}
          </Fragment>
        ))}
      </pre>
    </div>
  )
}

function Lines({ text, sign, className }: { text: string; sign: '-' | '+'; className: string }) {
  return (
    <>
      {text.split('\n').map((line, k) => (
        <div key={k} className={`min-h-[1lh] whitespace-pre ${className}`}>
          <span aria-hidden="true" className="select-none pr-2">
            {sign}
          </span>
          {line}
        </div>
      ))}
    </>
  )
}
