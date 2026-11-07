import { forwardRef } from 'react'
import type { AgentSummary } from '../../types'
import { STATUS_LABEL, STATUS_COLOR } from '../../lib/theme'
import { timeAgo } from '../../lib/format'

interface Props {
  agent?: AgentSummary
}

/** Compact preview that follows a hovered planet. Its position is set imperatively each frame. */
export const HoverCard = forwardRef<HTMLDivElement, Props>(function HoverCard({ agent }, ref) {
  return (
    <div
      ref={ref}
      aria-hidden="true"
      className="pointer-events-none absolute left-0 top-0 w-64 rounded-lg border border-tint/[0.08] glass-popover p-3 shadow-popover transition-opacity duration-150"
      style={{ opacity: 0 }}
    >
      {agent && (
        <>
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-body font-semibold text-ink">{agent.name}</span>
            <span className="shrink-0 text-label text-muted">{agent.providerName}</span>
          </div>
          <div className="mt-1.5 flex items-center gap-2 text-caption" style={{ color: STATUS_COLOR[agent.status] }}>
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: STATUS_COLOR[agent.status] }} />
            {STATUS_LABEL[agent.status]}
            {agent.statusDetail && <span className="truncate text-muted">· {agent.statusDetail}</span>}
          </div>
          {agent.task && <p className="mt-2 line-clamp-2 text-caption leading-snug text-muted">{agent.task}</p>}
          <div className="mt-2.5 flex items-center gap-3 border-t border-line pt-2 text-label text-faint">
            <span>{agent.fileCount} files</span>
            <span>{agent.toolCalls} tool calls</span>
            <span className="ml-auto">{timeAgo(agent.updatedAt)}</span>
          </div>
        </>
      )}
    </div>
  )
})
