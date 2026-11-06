import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { useStore, setInspectorTab, selectAgent, openDialog, toast, type InspectorTab } from '../../lib/store'
import { loadDetail, renameAgent, resumeAgent, stopAgent } from '../../lib/actions'
import { baseName, clock, dirName, elapsed, plural, tokens, timeAgo, usd } from '../../lib/format'
import { STATUS_COLOR } from '../../lib/theme'
import type { ActivityEntry, AgentSummary, Capabilities, FileActivity, Issue, ToolCall, Usage } from '../../types'
import { Button, IconAlert, IconChat, IconFiles, IconInfo, IconPencil, IconPlay, IconSidebar, IconStop, IconText, IconTrash, IconX, ProviderMark, StatusPill, Tag, type IconProps } from '../ui'
import { ChatTab, CodeBlock } from './ChatTab'
import { IconRetry } from './inspectorIcons'
import { VirtualList } from './VirtualList'

const TABS: { id: InspectorTab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'chat', label: 'Chat' },
  { id: 'activity', label: 'Activity' },
  { id: 'files', label: 'Files' },
  { id: 'tools', label: 'Tools' },
  { id: 'issues', label: 'Issues' },
]

const TAB_ICONS: Record<InspectorTab, (p: IconProps) => ReactNode> = {
  overview: (p) => <IconInfo {...p} />,
  chat: (p) => <IconChat {...p} />,
  activity: (p) => <IconSidebar {...p} />,
  files: (p) => <IconFiles {...p} />,
  tools: (p) => <IconText {...p} />,
  issues: (p) => <IconAlert {...p} />,
}

const PANEL_ID = 'inspector-panel'
const WIDTH = 400

export function Inspector() {
  const selectedId = useStore((s) => s.selectedId)
  const open = useStore((s) => s.inspectorOpen)
  const tab = useStore((s) => s.inspectorTab)
  const selectedAgent = useStore((s) => (s.selectedId ? s.agents[s.selectedId] : undefined))

  // Keep the last agent around while the panel animates closed, so it does not blank out mid-transition.
  const lastAgent = useRef<AgentSummary | undefined>(undefined)
  if (selectedAgent) lastAgent.current = selectedAgent
  const present = open && !!selectedAgent
  const { mounted, shown } = usePresence(present)
  const rawAgent = selectedAgent ?? lastAgent.current
  const agent = useMemo(() => (rawAgent ? withDefaults(rawAgent) : undefined), [rawAgent])
  const agentId = agent?.id

  const detail = useStore((s) => (agentId ? s.details[agentId] : undefined))
  const detailError = useStore((s) => (agentId ? s.detailErrors[agentId] : undefined))
  const project = useStore((s) => (agent ? s.projects[agent.projectId] : undefined))
  const detailFiles = useMemo(() => (detail?.loaded ? Object.values(detail.files) : undefined), [detail])

  useEffect(() => {
    if (selectedId) void loadDetail(selectedId)
  }, [selectedId])

  if (!mounted || !agent) return null

  const counts: Record<InspectorTab, number | undefined> = {
    overview: undefined,
    chat: detail?.messages.length,
    activity: detail?.activity.length,
    files: agent.fileCount,
    tools: agent.toolCalls,
    issues: agent.issueCount,
  }

  const focusTab = (id: InspectorTab) => {
    setInspectorTab(id)
    requestAnimationFrame(() => document.getElementById(`inspector-tab-${id}`)?.focus())
  }

  // Roving focus across the tab list, as the ARIA tabs pattern specifies.
  const onTabKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const idx = TABS.findIndex((t) => t.id === tab)
    let next = -1
    if (e.key === 'ArrowRight') next = (idx + 1) % TABS.length
    else if (e.key === 'ArrowLeft') next = (idx - 1 + TABS.length) % TABS.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = TABS.length - 1
    if (next < 0) return
    e.preventDefault()
    focusTab(TABS[next].id)
  }

  const historyFailed = !detail?.loaded && !!detailError
  const projectConflicts = project?.conflicts ?? []

  return (
    <aside
      className={`h-full shrink-0 overflow-hidden border-l border-line bg-sidebar transition-[width,opacity] duration-200 ease-out motion-reduce:transition-none ${
        shown ? 'w-[400px] opacity-100' : 'w-0 border-l-transparent opacity-0'
      }`}
      aria-label={`Inspector for ${agent.name}`}
      aria-hidden={!shown}
    >
      <div className="flex h-full flex-col" style={{ width: WIDTH }}>
        <Header agent={agent} />

        <div role="tablist" aria-label="Inspector sections" className="flex shrink-0 items-center gap-0.5 border-b border-line px-3" onKeyDown={onTabKey}>
          {TABS.map((t) => {
            const selected = t.id === tab
            return (
              <button
                key={t.id}
                id={`inspector-tab-${t.id}`}
                role="tab"
                aria-selected={selected}
                aria-controls={PANEL_ID}
                tabIndex={selected ? 0 : -1}
                onClick={() => setInspectorTab(t.id)}
                aria-label={t.label}
                title={t.label}
                className={`group relative -mb-px flex h-9 shrink-0 items-center gap-1.5 rounded-t-md transition-colors duration-150 ${
                  selected ? 'px-2.5 text-[12px] font-medium text-ink' : 'px-2 text-faint hover:bg-white/[0.03] hover:text-ink'
                }`}
              >
                <span className={`flex transition-colors duration-150 ${selected ? 'text-ink' : 'text-faint group-hover:text-muted'}`}>{TAB_ICONS[t.id]({ size: 14 })}</span>
                {selected && <span>{t.label}</span>}
                {counts[t.id] !== undefined && counts[t.id]! > 0 && (
                  <span className={`rounded px-1 font-mono text-[10px] leading-4 tabular-nums ${selected ? 'bg-white/[0.08] text-muted' : 'bg-white/[0.05] text-faint'}`}>
                    {counts[t.id]}
                  </span>
                )}
                <span
                  className={`absolute inset-x-2 -bottom-px h-[2px] rounded-full bg-ink transition-opacity duration-150 ${selected ? 'opacity-100' : 'opacity-0'}`}
                  aria-hidden="true"
                />
              </button>
            )
          })}
        </div>

        <div
          key={tab}
          id={PANEL_ID}
          role="tabpanel"
          aria-labelledby={`inspector-tab-${tab}`}
          className="flex min-h-0 flex-1 animate-[fade-in_140ms_ease-out] flex-col motion-reduce:animate-none"
        >
          {tab === 'overview' && <OverviewTab agent={agent} projectPath={project?.repoPath ?? ''} conflicts={projectConflicts.length} />}

          {tab === 'chat' && (
            <ChatTab key={agent.id} agent={agent} messages={detail?.messages} tools={detail?.tools} loaded={!!detail?.loaded} error={detailError} />
          )}

          {tab !== 'overview' && tab !== 'chat' && historyFailed && <HistoryError agentId={agent.id} message={detailError!} />}

          {tab === 'activity' && !historyFailed && <ActivityTab entries={detail?.activity} loaded={!!detail?.loaded} />}
          {tab === 'files' && !historyFailed && (
            <FilesTab
              agentId={agent.id}
              files={detail?.loaded ? detailFiles : agent.recentFiles}
              loaded={!!detail?.loaded}
              conflictPaths={new Set(projectConflicts.map((c) => c.path))}
            />
          )}
          {tab === 'tools' && !historyFailed && <ToolsTab tools={detail?.tools} loaded={!!detail?.loaded} />}
          {tab === 'issues' && !historyFailed && <IssuesTab issues={detail?.issues} loaded={!!detail?.loaded} />}
        </div>
      </div>
    </aside>
  )
}

/**
 * Mount and visibility for a panel that animates in and out. The panel stays mounted for
 * `duration` ms after closing, so the exit transition can finish.
 */
function usePresence(open: boolean, duration = 200): { mounted: boolean; shown: boolean } {
  const [mounted, setMounted] = useState(open)
  const [shown, setShown] = useState(open)
  useEffect(() => {
    if (open) {
      setMounted(true)
      // Wait a frame so the browser sees the closed state before the open one, and the transition runs.
      const frame = requestAnimationFrame(() => setShown(true))
      return () => cancelAnimationFrame(frame)
    }
    setShown(false)
    const timer = window.setTimeout(() => setMounted(false), duration)
    return () => window.clearTimeout(timer)
  }, [open, duration])
  return { mounted, shown }
}

/**
 * Fills in anything the backend left out, so a partial or older record still renders.
 * Nothing here invents activity: missing counts become zero, missing text becomes empty.
 */
const NO_CAPS: Capabilities = { stop: false, resume: false, send: false, cost: false, streaming: false, permissionModes: [] }
const NO_USAGE: Usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, costUsd: 0 }

function withDefaults(a: AgentSummary): AgentSummary {
  return {
    ...a,
    providerName: a.providerName || a.provider || 'Agent',
    model: a.model ?? '',
    task: a.task ?? '',
    statusDetail: a.statusDetail ?? '',
    sessionId: a.sessionId ?? '',
    turns: a.turns ?? 0,
    toolCalls: a.toolCalls ?? 0,
    fileCount: a.fileCount ?? 0,
    issueCount: a.issueCount ?? 0,
    lastError: a.lastError ?? '',
    recentFiles: Array.isArray(a.recentFiles) ? a.recentFiles : [],
    usage: { ...NO_USAGE, ...(a.usage ?? {}) },
    capabilities: {
      ...NO_CAPS,
      ...(a.capabilities ?? {}),
      permissionModes: Array.isArray(a.capabilities?.permissionModes) ? a.capabilities.permissionModes : [],
    },
  }
}

// ---- header ---------------------------------------------------------------------

function Header({ agent }: { agent: AgentSummary }) {
  const caps = agent.capabilities
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(agent.name)
  // Enter, Escape and blur can all end an edit; this makes sure only the first one counts.
  const finished = useRef(false)

  const startEdit = () => {
    finished.current = false
    setDraft(agent.name)
    setEditing(true)
  }
  const finishEdit = (save: boolean) => {
    if (finished.current) return
    finished.current = true
    setEditing(false)
    const next = draft.trim()
    if (save && next && next !== agent.name) void renameAgent(agent.id, next)
  }
  const onNameKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') finishEdit(true)
    if (e.key === 'Escape') finishEdit(false)
  }

  return (
    <header className="shrink-0 border-b border-line px-4 pb-3.5 pt-4">
      <div className="flex items-start gap-3">
        <ProviderMark provider={agent.provider} size={36} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            {editing ? (
              <input
                autoFocus
                aria-label="Agent name"
                value={draft}
                maxLength={60}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={onNameKey}
                onBlur={() => finishEdit(true)}
                className="min-w-0 flex-1 rounded-md border border-line-strong bg-surface px-2 py-0.5 text-[15px] font-semibold tracking-[-0.01em] text-ink outline-none focus:border-white/40"
              />
            ) : (
              <>
                <h2 className="truncate text-[15px] font-semibold tracking-[-0.01em] text-ink">{agent.name}</h2>
                <Button variant="ghost" size="sm" aria-label="Rename agent" title="Rename agent" onClick={startEdit} className="h-6 w-6 shrink-0 rounded-md px-0 text-faint">
                  <IconPencil size={12} />
                </Button>
              </>
            )}
          </div>
          <p className="mt-0.5 truncate font-mono text-[11px] text-faint">
            {agent.providerName}
            {agent.model ? ` · ${agent.model}` : ''}
          </p>
        </div>
        <Button variant="ghost" size="sm" aria-label="Close inspector" onClick={() => selectAgent(null)} className="-mr-1.5 h-7 w-7 shrink-0 rounded-md px-0">
          <IconX size={14} />
        </Button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <StatusPill status={agent.status} detail={agent.statusDetail} />
        <div className="ml-auto flex items-center gap-1">
          {agent.running && caps.stop && (
            <Button variant="danger" size="sm" onClick={() => void stopAgent(agent.id)} className="h-7">
              <IconStop size={11} />
              Stop
            </Button>
          )}
          {!agent.running && caps.resume && agent.turns > 0 && (
            <Button variant="secondary" size="sm" onClick={() => void resumeAgent(agent.id)} className="h-7">
              <IconPlay size={10} />
              Resume
            </Button>
          )}
          {/* Removal is destructive, so it always goes through a confirmation dialog. */}
          <Button variant="ghost" size="sm" aria-label="Remove agent" onClick={() => openDialog({ kind: 'remove', agentId: agent.id })} className="h-7 w-7 px-0 text-faint hover:text-danger-soft">
            <IconTrash size={13} />
          </Button>
        </div>
      </div>
    </header>
  )
}

// ---- overview ---------------------------------------------------------------------

function OverviewTab({ agent, projectPath, conflicts }: { agent: AgentSummary; projectPath: string; conflicts: number }) {
  const caps = agent.capabilities
  const [copied, setCopied] = useState(false)
  const now = useNow(agent.running)
  const modeLabel = caps.permissionModes.find((m) => m.id === agent.permissionMode)?.label ?? agent.permissionMode

  const copySession = async () => {
    if (!agent.sessionId) return
    try {
      await navigator.clipboard.writeText(agent.sessionId)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1400)
    } catch {
      toast('Could not copy to the clipboard', 'error')
    }
  }

  return (
    <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-4 py-4">
      <Section title="Task">
        <p className="text-[13px] leading-relaxed text-ink/90">{agent.task || 'No task yet. Send a message in Chat to give this agent work.'}</p>
        <p className="mt-2 text-[12px] text-muted">
          Current step: <span className="text-ink/80">{agent.statusDetail || '—'}</span>
        </p>
      </Section>

      <Section title="Progress">
        <div className="grid grid-cols-2 gap-2">
          <Stat label="Runtime" value={agent.running ? elapsed(agent.runStartedAt, now) : '—'} />
          <Stat label="Turns" value={String(agent.turns)} />
          <Stat label="Tool calls" value={String(agent.toolCalls)} />
          <Stat label="Files touched" value={String(agent.fileCount)} />
        </div>
        <p className="mt-2 text-[11px] text-faint">{agent.providerName} does not report percentage progress, so Orbit shows measured activity instead.</p>
      </Section>

      <Section title="Usage">
        <div className="grid grid-cols-2 gap-2">
          <Stat label="Input tokens" value={tokens(agent.usage.inputTokens)} />
          <Stat label="Output tokens" value={tokens(agent.usage.outputTokens)} />
          <Stat label="Cache reads" value={tokens(agent.usage.cacheReadTokens)} />
          <Stat label="Estimated cost" value={caps.cost ? usd(agent.usage.costUsd) : 'Not reported'} muted={!caps.cost} />
        </div>
      </Section>

      <Section title="Session">
        <dl className="overflow-hidden rounded-lg border border-line bg-surface/60 text-[12px] [&>div]:border-b [&>div]:border-line [&>div:last-child]:border-b-0">
          <Row k="Provider" v={agent.providerName} />
          <Row k="Model" v={agent.model || 'Provider default'} />
          <Row k="Permissions" v={modeLabel || '—'} />
          <Row k="Workspace" v={projectPath || '—'} mono />
          <Row k="Created" v={timeAgo(agent.createdAt)} />
          <Row k="Last update" v={timeAgo(agent.updatedAt)} />
          <div className="flex items-center justify-between gap-3 px-3 py-2">
            <dt className="shrink-0 text-muted">Session</dt>
            <dd className="flex min-w-0 items-center gap-2">
              <span className="truncate font-mono text-[11px] text-ink/80">{agent.sessionId || 'Not started yet'}</span>
              {agent.sessionId && (
                <Button variant="ghost" size="sm" onClick={() => void copySession()} aria-label="Copy session id" className="h-6 px-2 text-[11px]">
                  {copied ? 'Copied' : 'Copy'}
                </Button>
              )}
            </dd>
          </div>
        </dl>
        {conflicts > 0 && (
          <p className="mt-3 flex items-start gap-2 text-[12px] text-warn-soft">
            <IconAlert size={13} className="mt-0.5" />
            This project has {plural(conflicts, 'file')} written by more than one agent. See the sidebar.
          </p>
        )}
      </Section>

      {agent.lastError && (
        <Section title="Last error">
          <p className="rounded-lg border border-danger/25 bg-danger/[0.08] px-3 py-2 font-mono text-[12px] leading-relaxed text-danger-soft">{agent.lastError}</p>
        </Section>
      )}
    </div>
  )
}

/** Re-renders once a second while an agent runs, so elapsed time moves. */
function useNow(running: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!running) return
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [running])
  return now
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-faint">{title}</h3>
      {children}
    </section>
  )
}

function Stat({ label, value, muted = false }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="rounded-lg border border-line bg-surface/60 px-3 py-2.5">
      <div className="text-[11px] text-muted">{label}</div>
      <div className={`mt-0.5 truncate font-semibold tabular-nums ${muted ? 'text-[12px] font-medium text-faint' : 'text-[15px] text-ink'}`}>{value}</div>
    </div>
  )
}

function Row({ k, v, mono = false }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 px-3 py-2">
      <dt className="shrink-0 text-muted">{k}</dt>
      <dd className={`min-w-0 truncate text-right text-ink/85 ${mono ? 'font-mono text-[11px]' : ''}`} title={v}>
        {v}
      </dd>
    </div>
  )
}

// ---- history error (shared by the tabs that need the full history) -----------------------

function HistoryError({ agentId, message }: { agentId: string; message: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
      <p className="text-[13px] font-medium text-ink/85">Couldn’t load this agent’s history</p>
      <p className="mt-1 max-w-[280px] text-[12px] leading-relaxed text-faint">{message}</p>
      <Button variant="secondary" size="sm" className="mt-4" onClick={() => void loadDetail(agentId)}>
        <IconRetry size={12} />
        Try again
      </Button>
    </div>
  )
}

// ---- activity -----------------------------------------------------------------------

/** Log colours: one per event kind, from the same status tokens the planets use. */
const KIND_COLOR: Record<ActivityEntry['kind'], string> = {
  status: STATUS_COLOR.idle,
  tool: STATUS_COLOR.reading,
  file: STATUS_COLOR.writing,
  message: 'var(--color-ink)',
  error: STATUS_COLOR.failed,
  warning: 'var(--color-warn)',
  system: 'var(--color-muted)',
}

type ActivityFilter = 'all' | 'problems' | 'tools' | 'files'

const ACTIVITY_FILTERS: { id: ActivityFilter; label: string; match: (k: ActivityEntry['kind']) => boolean }[] = [
  { id: 'all', label: 'All', match: () => true },
  { id: 'problems', label: 'Problems', match: (k) => k === 'error' || k === 'warning' },
  { id: 'tools', label: 'Tools', match: (k) => k === 'tool' },
  { id: 'files', label: 'Files', match: (k) => k === 'file' },
]

function ActivityTab({ entries, loaded }: { entries?: ActivityEntry[]; loaded: boolean }) {
  const [filter, setFilter] = useState<ActivityFilter>('all')
  const shown = useMemo(() => {
    const match = ACTIVITY_FILTERS.find((f) => f.id === filter)?.match ?? (() => true)
    return (entries ?? []).filter((e) => match(e.kind))
  }, [entries, filter])
  if (!loaded) return <Loading />

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-1 border-b border-line px-3 py-2" role="group" aria-label="Filter activity">
        {ACTIVITY_FILTERS.map((f) => {
          const selected = f.id === filter
          return (
            <button
              key={f.id}
              aria-pressed={selected}
              onClick={() => setFilter(f.id)}
              className={`rounded-md px-2 py-1 text-[11px] transition-colors duration-150 ${selected ? 'bg-white/[0.08] text-ink' : 'text-faint hover:bg-white/[0.04] hover:text-muted'}`}
            >
              {f.label}
            </button>
          )
        })}
      </div>
      <VirtualList
        items={shown}
        rowHeight={28}
        stickToEnd
        className="px-2 py-2"
        empty={<Empty title={filter === 'all' ? 'No activity yet' : 'Nothing in this filter'} body={filter === 'all' ? 'Events appear here as the agent works.' : 'Switch the filter to see other events.'} />}
        renderRow={(e) => (
          <div className="flex h-full items-center gap-2.5 rounded px-2 font-mono text-[11.5px] hover:bg-white/[0.03]">
            <span className="w-[88px] shrink-0 whitespace-nowrap tabular-nums text-faint">{clock(e.at)}</span>
            <span className="w-[68px] shrink-0 whitespace-nowrap text-[9.5px] font-semibold uppercase tracking-[0.08em]" style={{ color: KIND_COLOR[e.kind] ?? KIND_COLOR.system }}>
              {e.kind}
            </span>
            <span className={`truncate ${e.kind === 'error' ? 'text-danger-soft' : 'text-ink/85'}`} title={e.text}>
              {e.text}
            </span>
          </div>
        )}
      />
    </div>
  )
}

// ---- files ----------------------------------------------------------------------------

const FILE_COLOR: Record<FileActivity['state'], string> = {
  writing: STATUS_COLOR.writing,
  reading: STATUS_COLOR.reading,
  recent: STATUS_COLOR.idle,
}

function FilesTab({
  agentId,
  files,
  loaded,
  conflictPaths,
}: {
  agentId: string
  files: FileActivity[] | undefined
  loaded: boolean
  conflictPaths: Set<string>
}) {
  const sorted = useMemo(() => [...(files ?? [])].sort((a, b) => (b.lastAt || 0) - (a.lastAt || 0)), [files])
  if (!files || (!loaded && sorted.length === 0)) return <Loading />
  return (
    <VirtualList
      items={sorted}
      rowHeight={54}
      className="px-2 py-2"
      empty={<Empty title="No files yet" body="Files the agent reads or writes appear here, and as orbiting planets in the universe." />}
      renderRow={(f) => {
        const color = FILE_COLOR[f.state] ?? STATUS_COLOR.idle // tolerate states added by the backend later
        return (
          <button
            onClick={() => openDialog({ kind: 'file', agentId, path: f.path })}
            aria-label={`Open diff for ${baseName(f.path)}`}
            className="group flex h-full w-full items-center gap-3 rounded-lg px-2.5 text-left transition-colors duration-150 hover:bg-white/[0.04]"
          >
            <span className="relative flex h-2 w-2 shrink-0">
              {f.state === 'writing' && <span className="absolute inset-0 animate-ping rounded-full opacity-60 motion-reduce:animate-none" style={{ background: color }} />}
              <span className="relative h-2 w-2 rounded-full" style={{ background: color }} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <span className="truncate text-[13px] font-medium text-ink">{baseName(f.path)}</span>
                {conflictPaths.has(f.path) && <Tag tone="warn">Conflict</Tag>}
              </span>
              <span className="block truncate font-mono text-[10.5px] text-faint" title={f.path}>
                {dirName(f.path) || f.path}
              </span>
            </span>
            <span className="shrink-0 text-right font-mono text-[10.5px] tabular-nums text-muted">
              <span className="block">
                {f.writes ?? 0}w · {f.reads ?? 0}r
              </span>
              <span className="block text-faint">{timeAgo(f.lastAt)}</span>
            </span>
          </button>
        )
      }}
    />
  )
}

// ---- tools ------------------------------------------------------------------------------

const TOOL_STATUS: Record<ToolCall['status'], { label: string; color: string }> = {
  running: { label: 'Running', color: STATUS_COLOR.thinking },
  ok: { label: 'Done', color: STATUS_COLOR.completed },
  error: { label: 'Failed', color: STATUS_COLOR.failed },
}

function ToolsTab({ tools, loaded }: { tools?: ToolCall[]; loaded: boolean }) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  if (!loaded || !tools) return <Loading />
  // Follow the newest call until the user picks one, then keep their choice.
  const selected = tools.find((t) => t.id === selectedId) ?? tools[tools.length - 1]
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <VirtualList
        items={tools}
        rowHeight={36}
        stickToEnd
        className="px-2 py-2"
        empty={<Empty title="No tool calls yet" body="Commands, file edits and searches the agent makes are listed here." />}
        renderRow={(t) => {
          const status = TOOL_STATUS[t.status] ?? TOOL_STATUS.running
          const active = selected?.id === t.id
          return (
            <button
              onClick={() => setSelectedId(t.id)}
              aria-pressed={active}
              className={`flex h-full w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[12px] transition-colors duration-150 hover:bg-white/[0.04] ${active ? 'bg-white/[0.06]' : ''}`}
            >
              <span className="w-12 shrink-0 truncate font-mono text-[11px] font-medium text-ink">{t.name || 'Tool'}</span>
              <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted">{t.summary}</span>
              <span className="flex shrink-0 items-center gap-1.5 text-[11px]" style={{ color: status.color }}>
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: status.color }} />
                {status.label}
              </span>
            </button>
          )
        }}
      />
      {selected && (
        <div className="max-h-[44%] shrink-0 space-y-3 overflow-y-auto border-t border-line bg-canvas/50 px-4 py-3">
          <div className="flex items-center justify-between font-mono text-[11px] text-muted">
            <span className="font-medium text-ink">{selected.name || 'Tool'}</span>
            <span className="text-faint">{clock(selected.at)}</span>
          </div>
          <CodeBlock label="Input" text={selected.input} />
          <CodeBlock
            label="Result"
            text={selected.output}
            placeholder={selected.status === 'running' ? 'Waiting for result…' : 'No output'}
            danger={selected.status === 'error'}
          />
        </div>
      )}
    </div>
  )
}

// ---- issues -------------------------------------------------------------------------------

function IssuesTab({ issues, loaded }: { issues?: Issue[]; loaded: boolean }) {
  if (!loaded || !issues) return <Loading />
  const ordered = [...issues].reverse()
  return (
    <VirtualList
      items={ordered}
      rowHeight={56}
      className="px-2 py-2"
      empty={<Empty title="No errors or warnings" body="Problems the agent or provider reports show up here." />}
      renderRow={(i) => (
        <div className="flex h-full items-start gap-3 rounded-lg px-2.5 py-2 hover:bg-white/[0.03]">
          <span className="mt-0.5">
            <Tag tone={i.level === 'error' ? 'warn' : 'neutral'}>{i.level}</Tag>
          </span>
          <span className="min-w-0 flex-1">
            <span className="line-clamp-2 text-[12px] leading-snug text-ink/90" title={i.text}>
              {i.text}
            </span>
            <span className="mt-0.5 block font-mono text-[10px] text-faint">{clock(i.at)}</span>
          </span>
        </div>
      )}
    />
  )
}

// ---- shared bits ----------------------------------------------------------------------------

function Loading() {
  return (
    <div className="flex flex-1 items-center justify-center text-[12px] text-muted" role="status">
      Loading history…
    </div>
  )
}

function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="px-6 text-center">
      <p className="text-[13px] font-medium text-ink/80">{title}</p>
      <p className="mt-1 text-[12px] leading-relaxed text-faint">{body}</p>
    </div>
  )
}
