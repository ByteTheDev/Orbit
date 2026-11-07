import { useMemo, useState } from 'react'
import { selectAgent } from '../../lib/store'
import { STATUS_COLOR } from '../../lib/theme'
import type { AgentSummary, ProjectSummary } from '../../types'
import { ProviderMark } from '../ui'
import { agentBucket } from './agentStatus'
import { ActivitySweep, StatusGlyph } from './AgentItem'

/** Rows shown before "Show all". Keeps the section a glance, not a second list. */
const PREVIEW = 4

interface Props {
  /** Every agent, in sidebar order. */
  agents: AgentSummary[]
  projects: Record<string, ProjectSummary>
  selectedId: string | null
  onFocusAgent: (agentId: string) => void
}

/**
 * A compact strip across all projects: agents that need attention first, then agents running now.
 * It is a shortcut, not a second hierarchy: rows show the project name beneath the agent, and the
 * section hides while a search or filter is on, so the project tree below stays the single source.
 */
export function ActiveAgents({ agents, projects, selectedId, onFocusAgent }: Props) {
  const [showAll, setShowAll] = useState(false)

  const { attention, running } = useMemo(() => {
    const attention: AgentSummary[] = []
    const running: AgentSummary[] = []
    for (const a of agents) {
      const b = agentBucket(a.status)
      if (b === 'attention') attention.push(a)
      else if (b === 'running') running.push(a)
    }
    return { attention, running }
  }, [agents])

  if (agents.length === 0) return null

  const items = [...attention, ...running]
  if (items.length === 0) {
    return (
      <section aria-label="Active agents" className="mx-3 mb-2 flex items-center gap-2 px-1 py-1 text-caption text-faint">
        <span className="h-1.5 w-1.5 rounded-full border border-current opacity-60" aria-hidden="true" />
        Nothing running right now
      </section>
    )
  }

  const shown = showAll ? items : items.slice(0, PREVIEW)
  const hidden = items.length - shown.length

  return (
    <section aria-label="Active agents" className="mx-2 mb-2 rounded-xl border border-white/[0.06] bg-white/[0.02] px-1.5 pb-1.5 pt-2">
      <header className="mb-1 flex items-center justify-between gap-2 px-1.5">
        <h3 className="text-label font-semibold uppercase tracking-[0.12em] text-faint">Active</h3>
        <div className="flex items-center gap-2 text-label tabular-nums">
          {attention.length > 0 && (
            <span className="font-medium text-warn-soft">{attention.length} need{attention.length === 1 ? 's' : ''} attention</span>
          )}
          {running.length > 0 && <span className="text-status-thinking">{running.length} running</span>}
        </div>
      </header>

      <ul className="space-y-px" role="list">
        {shown.map((a) => {
          const selected = a.id === selectedId
          const projectName = projects[a.projectId]?.name ?? 'Unknown project'
          const needsAttention = agentBucket(a.status) === 'attention'
          return (
            <li key={a.id} className="relative">
              <button
                type="button"
                data-nav-item
                onClick={() => {
                  selectAgent(a.id, { openInspector: true })
                  onFocusAgent(a.id)
                }}
                aria-current={selected ? 'true' : undefined}
                title={`${a.name} · ${projectName}${a.statusDetail ? ` · ${a.statusDetail}` : ''}`}
                className={`group/active relative flex w-full items-center gap-2 rounded-md py-1.5 pl-2 pr-2 text-left transition-colors duration-150 ${
                  selected ? 'bg-white/[0.085]' : 'hover:bg-white/[0.05]'
                }`}
              >
                {needsAttention && (
                  <span aria-hidden="true" className="absolute inset-y-1.5 left-0 w-0.5 rounded-full" style={{ background: STATUS_COLOR[a.status] }} />
                )}
                <ProviderMark provider={a.provider} size={16} />
                <span className="min-w-0 flex-1">
                  <span className="flex min-w-0 items-baseline gap-1.5">
                    <span className="min-w-0 truncate text-caption font-medium leading-tight text-ink/90">{a.name}</span>
                    <span className="min-w-0 truncate text-label leading-tight text-faint">{projectName}</span>
                  </span>
                  {a.statusDetail && <span className="block truncate text-label leading-snug text-faint">{a.statusDetail}</span>}
                </span>
                <StatusGlyph status={a.status} running={a.running} />
                {a.running && <ActivitySweep color={STATUS_COLOR[a.status]} />}
              </button>
            </li>
          )
        })}
      </ul>

      {items.length > PREVIEW && (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="mt-1 w-full rounded-md px-2 py-1 text-left text-label text-faint transition-colors duration-150 hover:bg-white/[0.04] hover:text-ink"
        >
          {showAll ? 'Show fewer' : `Show ${hidden} more`}
        </button>
      )}
    </section>
  )
}
