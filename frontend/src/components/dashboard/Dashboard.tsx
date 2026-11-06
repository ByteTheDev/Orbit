import { useEffect, useMemo, useState } from 'react'
import { STATUS_COLOR, STATUS_LABEL, starColorFor } from '../../lib/theme'
import { elapsed, projectMark, timeAgo, tokens, usd } from '../../lib/format'
import { focusAgent, selectAgent, setState, useStore } from '../../lib/store'
import type { AgentSummary, ProjectSummary } from '../../types'
import { Button, IconX, Kbd } from '../ui'

/**
 * Mission control: every agent in every project, in one place. Projects are the
 * universes; each lists its agents with live status, runtime and spend. Picking a
 * row flies the camera to that agent on the canvas.
 */
export function Dashboard() {
  const projectsMap = useStore((s) => s.projects)
  const projectOrder = useStore((s) => s.projectOrder)
  const agentsMap = useStore((s) => s.agents)
  const agentOrder = useStore((s) => s.agentOrder)

  // Keep timers live: tick each second while an agent runs, and every 30s otherwise so
  // "ago" labels stay roughly right. Idle dashboards no longer re-render every second.
  const anyRunning = useMemo(() => agentOrder.some((id) => agentsMap[id]?.running), [agentOrder, agentsMap])
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), anyRunning ? 1000 : 30_000)
    return () => window.clearInterval(id)
  }, [anyRunning])

  const projects = useMemo(() => projectOrder.map((id) => projectsMap[id]).filter(Boolean), [projectOrder, projectsMap])
  const agents = useMemo(() => agentOrder.map((id) => agentsMap[id]).filter(Boolean), [agentOrder, agentsMap])

  const totals = useMemo(() => {
    let running = 0
    let attention = 0
    let cost = 0
    let tok = 0
    for (const a of agents) {
      if (a.running) running++
      if (a.status === 'failed' || a.status === 'waiting') attention++
      cost += a.usage.costUsd
      tok += a.usage.inputTokens + a.usage.outputTokens
    }
    const conflicts = projects.reduce((n, p) => n + p.conflicts.length, 0)
    return { running, attention, cost, tok, conflicts }
  }, [agents, projects])

  const close = () => setState({ dashboardOpen: false })
  const open = (agent: AgentSummary) => {
    selectAgent(agent.id, { openInspector: true })
    focusAgent(agent.id)
    close()
  }

  return (
    <section className="absolute inset-0 z-20 flex flex-col bg-canvas/[0.97] backdrop-blur-sm" aria-label="Dashboard">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-line px-5">
        <h2 className="text-[14px] font-semibold text-ink">Mission control</h2>
        <span className="text-[12px] text-faint">
          {projects.length} project{projects.length === 1 ? '' : 's'} · {agents.length} agent{agents.length === 1 ? '' : 's'}
        </span>
        <div className="flex-1" />
        <span className="hidden items-center gap-1.5 text-[11px] text-faint sm:flex">
          Close <Kbd>D</Kbd>
        </span>
        <Button variant="ghost" size="sm" onClick={close} aria-label="Close dashboard" className="h-8 w-8 px-0">
          <IconX size={14} />
        </Button>
      </header>

      <div className="grid shrink-0 grid-cols-2 gap-px border-b border-line bg-line sm:grid-cols-5">
        <Tile label="Running" value={String(totals.running)} tone={totals.running > 0 ? STATUS_COLOR.thinking : undefined} />
        <Tile label="Needs attention" value={String(totals.attention)} tone={totals.attention > 0 ? STATUS_COLOR.failed : undefined} />
        <Tile label="Conflicting files" value={String(totals.conflicts)} tone={totals.conflicts > 0 ? 'var(--color-warn)' : undefined} />
        <Tile label="Tokens" value={tokens(totals.tok)} />
        <Tile label="Spend" value={usd(totals.cost)} />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {projects.length === 0 && <p className="py-16 text-center text-[13px] text-muted">No projects yet. Create one to start a universe.</p>}

        {projects.map((project) => (
          <ProjectSection
            key={project.id}
            project={project}
            color={starColorFor(project.id)}
            agents={agents.filter((a) => a.projectId === project.id)}
            now={now}
            onOpen={open}
          />
        ))}
      </div>
    </section>
  )
}

function Tile({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="bg-canvas px-5 py-3">
      <p className="text-[11px] uppercase tracking-[0.08em] text-faint">{label}</p>
      <p className="mt-1 text-[20px] font-semibold tabular-nums" style={{ color: tone ?? 'var(--color-ink)' }}>
        {value}
      </p>
    </div>
  )
}

function ProjectSection({
  project,
  color,
  agents,
  now,
  onOpen,
}: {
  project: ProjectSummary
  color: string
  agents: AgentSummary[]
  now: number
  onOpen: (agent: AgentSummary) => void
}) {
  return (
    <div className="mb-6">
      <div className="mb-2 flex items-center gap-2.5">
        <span
          className="flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-extrabold text-canvas"
          style={{ background: color, boxShadow: `0 0 12px ${color}55` }}
          aria-hidden="true"
        >
          {projectMark(project)}
        </span>
        <h3 className="text-[13px] font-semibold text-ink">{project.name}</h3>
        <span className="text-[12px] text-faint">
          {agents.length} agent{agents.length === 1 ? '' : 's'}
          {project.runningCount > 0 && ` · ${project.runningCount} running`}
        </span>
        {project.conflicts.length > 0 && <span className="text-[12px] text-warn">· {project.conflicts.length} conflicting</span>}
      </div>

      {agents.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line-strong px-4 py-3 text-[12px] text-faint">No agents in this universe yet.</p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-line">
          <div className="grid grid-cols-[minmax(0,2.2fr)_minmax(0,1.4fr)_88px_64px_64px_80px] gap-3 border-b border-line bg-surface px-4 py-2 text-[11px] uppercase tracking-[0.06em] text-faint">
            <span>Agent</span>
            <span>Status</span>
            <span className="text-right">Runtime</span>
            <span className="text-right">Turns</span>
            <span className="text-right">Tools</span>
            <span className="text-right">Cost</span>
          </div>
          {agents.map((a) => (
            <AgentRow key={a.id} agent={a} now={now} onOpen={onOpen} />
          ))}
        </div>
      )}
    </div>
  )
}

function AgentRow({ agent: a, now, onOpen }: { agent: AgentSummary; now: number; onOpen: (agent: AgentSummary) => void }) {
  const color = STATUS_COLOR[a.status]
  const runtime = a.running && a.runStartedAt ? elapsed(a.runStartedAt, now) : a.updatedAt ? timeAgo(a.updatedAt, now) : '—'
  return (
    <button
      type="button"
      onClick={() => onOpen(a)}
      className="grid w-full grid-cols-[minmax(0,2.2fr)_minmax(0,1.4fr)_88px_64px_64px_80px] items-center gap-3 border-b border-line px-4 py-2.5 text-left transition-colors last:border-b-0 hover:bg-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
    >
      <span className="min-w-0">
        <span className="block truncate text-[13px] font-medium text-ink">{a.name}</span>
        <span className="block truncate text-[12px] text-muted">{a.task || a.providerName}</span>
      </span>
      <span className="min-w-0">
        <span className="flex items-center gap-1.5 text-[12px]" style={{ color }}>
          <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: color }} />
          {STATUS_LABEL[a.status]}
        </span>
        {a.statusDetail && <span className="block truncate text-[11px] text-faint">{a.statusDetail}</span>}
      </span>
      <span className="text-right text-[12px] tabular-nums text-muted">{runtime}</span>
      <span className="text-right text-[12px] tabular-nums text-muted">{a.turns}</span>
      <span className="text-right text-[12px] tabular-nums text-muted">{a.toolCalls}</span>
      <span className="text-right text-[12px] tabular-nums text-muted">{a.capabilities.cost ? usd(a.usage.costUsd) : '—'}</span>
    </button>
  )
}
