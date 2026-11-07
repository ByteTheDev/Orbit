import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { STATUS_COLOR, STATUS_LABEL } from '../../lib/theme'
import { elapsed, tokens, usd } from '../../lib/format'
import { focusAgent, openDialog, selectAgent, setState, useStore } from '../../lib/store'
import type { AgentSummary, ProjectSummary, Status } from '../../types'
import { Button, IconX, Kbd } from '../ui'

/** One grid for every column header and row, so the columns always line up. */
const ROW_COLS = 'grid-cols-[minmax(0,2.2fr)_minmax(0,1.4fr)_88px_56px_56px_80px]'

/** Statuses that need the user's eyes now. They float to the top as "Active now". */
const NEEDS_EYES: Status[] = ['waiting', 'failed']

/**
 * Mission control: system health first, then the agents that are working or waiting on you,
 * then every project's full roster. Picking a row flies the camera to that agent on the canvas.
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

  const active = useMemo(() => agents.filter((a) => a.running || NEEDS_EYES.includes(a.status)), [agents])

  const totals = useMemo(() => {
    let running = 0
    let attention = 0
    let cost = 0
    let tok = 0
    for (const a of agents) {
      if (a.running) running++
      if (NEEDS_EYES.includes(a.status)) attention++
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
    <section className="absolute inset-0 z-20 flex animate-fade-in flex-col bg-canvas/[0.97] backdrop-blur-sm motion-reduce:animate-none" aria-label="Dashboard">
      <header className="flex h-12 shrink-0 items-center gap-3 px-5">
        <h2 className="text-title font-semibold text-ink">Mission control</h2>
        <div className="flex-1" />
        <span className="hidden items-center gap-1.5 text-caption text-faint sm:flex">
          Close <Kbd>D</Kbd>
        </span>
        <Button variant="ghost" size="sm" onClick={close} aria-label="Close dashboard" className="h-7 w-7 px-0">
          <IconX size={14} />
        </Button>
      </header>

      <Metrics
        items={[
          { label: 'Running', value: totals.running, tone: totals.running > 0 ? STATUS_COLOR.thinking : undefined },
          {
            label: 'Needs attention',
            value: totals.attention,
            tone: totals.attention > 0 ? STATUS_COLOR.failed : undefined,
            hint: 'Agents right now that are waiting for you or have failed. The !N counts in the sidebar are a separate, running total of logged issues.',
          },
          { label: 'Conflicts', value: totals.conflicts, tone: totals.conflicts > 0 ? 'var(--color-warn)' : undefined },
          { label: 'Agents', value: agents.length },
          { label: 'Tokens', value: tokens(totals.tok) },
          { label: 'Spend', value: usd(totals.cost) },
        ]}
      />

      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-8 pt-5">
        {projects.length === 0 ? (
          <EmptyUniverse />
        ) : (
          <>
            {active.length > 0 && (
              <Group title="Active now" count={active.length}>
                {active.map((a) => (
                  <AgentRow key={a.id} agent={a} projectName={projectsMap[a.projectId]?.name} now={now} onOpen={open} />
                ))}
              </Group>
            )}

            <div className="space-y-6">
              {projects.map((project) => (
                <ProjectGroup
                  key={project.id}
                  project={project}
                  agents={agents.filter((a) => a.projectId === project.id)}
                  now={now}
                  onOpen={open}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </section>
  )
}

/** A single line of numbers, not a row of boxes. Non-zero health figures take a tone; zero stays quiet. */
function Metrics({ items }: { items: { label: string; value: number | string; tone?: string; hint?: string }[] }) {
  return (
    <dl className="flex shrink-0 flex-wrap items-baseline gap-x-7 gap-y-2 border-b border-line px-5 pb-3.5 pt-1">
      {items.map((m) => (
        <div key={m.label} className="flex items-baseline gap-2" title={m.hint}>
          <dt className="text-caption text-muted">{m.label}</dt>
          <dd className="text-title font-semibold tabular-nums text-ink" style={m.tone ? { color: m.tone } : undefined}>
            {m.value}
          </dd>
        </div>
      ))}
    </dl>
  )
}

function Group({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  return (
    <section className="mb-6" aria-label={title}>
      <header className="mb-1 flex items-baseline gap-2 px-2">
        <h3 className="text-body font-semibold text-ink">{title}</h3>
        {count !== undefined && <span className="text-caption text-faint">{count}</span>}
      </header>
      <ColumnHeader />
      <div>{children}</div>
    </section>
  )
}

function ColumnHeader() {
  return (
    <div className={`grid ${ROW_COLS} gap-3 px-2 pb-1 text-caption text-faint`} aria-hidden="true">
      <span>Agent</span>
      <span>Status</span>
      <span className="text-right">Runtime</span>
      <span className="text-right">Turns</span>
      <span className="text-right">Tools</span>
      <span className="text-right">Cost</span>
    </div>
  )
}

function ProjectGroup({
  project,
  agents,
  now,
  onOpen,
}: {
  project: ProjectSummary
  agents: AgentSummary[]
  now: number
  onOpen: (agent: AgentSummary) => void
}) {
  const conflicts = project.conflicts.length
  const count = `${agents.length} agent${agents.length === 1 ? '' : 's'}`
  return (
    <section aria-label={project.name}>
      <header className="mb-1 flex flex-wrap items-center gap-x-3 gap-y-1 px-2">
        <h3 className="text-body font-semibold text-ink">{project.name}</h3>
        <span className="text-caption text-faint">
          {count}
          {project.runningCount > 0 && <span className="text-muted"> · {project.runningCount} running</span>}
        </span>
        {conflicts > 0 && (
          <span className="inline-flex items-center gap-1.5 text-caption font-medium text-warn-soft">
            <span className="h-1.5 w-1.5 rounded-full bg-warn" aria-hidden="true" />
            {conflicts} conflicting file{conflicts === 1 ? '' : 's'}
          </span>
        )}
        <div className="flex-1" />
        <StatusMix agents={agents} />
      </header>

      {agents.length === 0 ? (
        <div className="flex items-center justify-between gap-3 rounded-md px-2 py-2 text-body text-faint">
          <span>No agents here yet.</span>
          <button
            type="button"
            onClick={() => openDialog({ kind: 'launch', projectId: project.id })}
            className="rounded text-muted underline-offset-2 transition-colors hover:text-ink hover:underline"
          >
            Launch one
          </button>
        </div>
      ) : (
        <>
          <ColumnHeader />
          <div>
            {agents.map((a) => (
              <AgentRow key={a.id} agent={a} now={now} onOpen={onOpen} />
            ))}
          </div>
        </>
      )}
    </section>
  )
}

function EmptyUniverse() {
  return (
    <div className="mx-auto mt-20 flex max-w-sm flex-col items-center text-center">
      <span className="mb-4 flex h-10 w-10 items-center justify-center rounded-full border border-line" aria-hidden="true">
        <span className="h-2 w-2 rounded-full bg-muted" />
      </span>
      <p className="text-title font-semibold text-ink">No projects yet</p>
      <p className="mt-1.5 text-body leading-relaxed text-muted">
        A project is a repository folder. Add one from the sidebar, then launch agents into it. Their status shows up here.
      </p>
    </div>
  )
}

/** Fixed order for the status bar, so the same state always sits in the same place. */
const STATUS_ORDER: Status[] = ['thinking', 'writing', 'reading', 'waiting', 'completed', 'failed', 'stopped', 'idle']

/**
 * A breakdown of the agents by their current status: one segment per state, in a fixed order.
 * Segment width is the share of agents in that state. It is not task progress, which Orbit cannot measure.
 */
function StatusMix({ agents }: { agents: AgentSummary[] }) {
  if (agents.length === 0) return null
  const counts = new Map<Status, number>()
  for (const a of agents) counts.set(a.status, (counts.get(a.status) ?? 0) + 1)
  const segments = STATUS_ORDER.filter((s) => counts.has(s)).map((s) => ({ status: s, n: counts.get(s) ?? 0 }))
  const summary = segments.map(({ status, n }) => `${n} ${STATUS_LABEL[status].toLowerCase()}`).join(', ')
  return (
    <div
      className="flex items-center gap-2"
      title={`Status breakdown of ${agents.length} agent${agents.length === 1 ? '' : 's'} right now (${summary}). This shows how many agents are in each state, not how far the work has progressed.`}
    >
      <span className="text-label text-faint">Status</span>
      <div className="flex h-1 w-28 overflow-hidden rounded-full bg-white/[0.06]" role="img" aria-label={`Agent status: ${summary}`}>
        {segments.map(({ status, n }) => (
          <span key={status} title={`${STATUS_LABEL[status]}: ${n}`} style={{ width: `${(n / agents.length) * 100}%`, background: STATUS_COLOR[status] }} />
        ))}
      </div>
    </div>
  )
}

function AgentRow({
  agent: a,
  projectName,
  now,
  onOpen,
}: {
  agent: AgentSummary
  projectName?: string
  now: number
  onOpen: (agent: AgentSummary) => void
}) {
  const color = STATUS_COLOR[a.status]
  // The column is a duration. A finished agent has no live runtime to show, so it shows a dash rather than a time since last update.
  const runtime = a.running && a.runStartedAt ? elapsed(a.runStartedAt, now) : '—'
  const subtitle = [projectName, a.task || a.providerName].filter(Boolean).join(' · ')
  return (
    <button
      type="button"
      onClick={() => onOpen(a)}
      className={`group grid w-full ${ROW_COLS} items-center gap-3 rounded-md px-2 py-2 text-left transition-colors duration-150 hover:bg-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus`}
    >
      <span className="min-w-0">
        <span className="block truncate text-body font-medium text-ink">{a.name}</span>
        <span className="block truncate text-caption text-muted">{subtitle}</span>
      </span>
      <span className="min-w-0">
        <span className="inline-flex max-w-full items-center gap-1.5 text-caption font-medium" style={{ color }}>
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${a.running ? 'animate-pulse motion-reduce:animate-none' : ''}`} style={{ background: color }} />
          <span className="truncate">{STATUS_LABEL[a.status]}</span>
        </span>
        {a.statusDetail && <span className="mt-0.5 block truncate text-caption text-faint">{a.statusDetail}</span>}
      </span>
      <span className="text-right text-caption tabular-nums text-muted">{runtime}</span>
      <span className="text-right text-caption tabular-nums text-muted">{a.turns}</span>
      <span className="text-right text-caption tabular-nums text-muted">{a.toolCalls}</span>
      <span className="text-right text-caption tabular-nums text-muted">{a.capabilities.cost ? usd(a.usage.costUsd) : '—'}</span>
    </button>
  )
}
