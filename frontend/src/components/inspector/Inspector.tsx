import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import { useStore, setFocusMode, setInspectorTab, selectAgent, openDialog, toast, toggleGalaxyBesideChat, type InspectorTab } from '../../lib/store'
import { INSPECTOR_DEFAULT, INSPECTOR_MAX, INSPECTOR_MIN, clampInspectorWidth, loadInspectorWidth, saveInspectorWidth, toggleInspectorWidth } from '../../lib/inspectorPrefs'
import { loadDetail, renameAgent, resumeAgent, stopAgent } from '../../lib/actions'
import { baseName, dirName, elapsed, plural, tokens, timeAgo, usd } from '../../lib/format'
import { STATUS_COLOR } from '../../lib/theme'
import type { AgentSummary, Capabilities, FileActivity, Usage } from '../../types'
import { Button, IconAlert, IconChat, IconFiles, IconInfo, IconPencil, IconPlay, IconStop, IconTrash, IconX, ProviderMark, StatusPill, Tag, type IconProps } from '../ui'
import { FileIcon } from '../ui/FileIcon'
import { ChatTab } from './ChatTab'
import { IconBranch, IconCollapse, IconExpand, IconGalaxy, IconMaximize, IconMinimize, IconRetry } from './inspectorIcons'
import { GitTab } from './GitTab'
import { VirtualList } from './VirtualList'

const TABS: { id: InspectorTab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'chat', label: 'Chat' },
  { id: 'files', label: 'Files' },
  { id: 'changes', label: 'Changes' },
]

const TAB_ICONS: Record<InspectorTab, (p: IconProps) => ReactNode> = {
  overview: (p) => <IconInfo {...p} />,
  chat: (p) => <IconChat {...p} />,
  files: (p) => <IconFiles {...p} />,
  changes: (p) => <IconBranch {...p} />,
}

const PANEL_ID = 'inspector-panel'
export function Inspector() {
  // The panel's width is set by dragging its left edge. It is remembered between launches.
  const [width, setWidth] = useState(loadInspectorWidth)
  const [resizing, setResizing] = useState(false)
  const panelRef = useRef<HTMLElement>(null)
  const drag = useRef<{ startX: number; startWidth: number; last: number } | null>(null)

  const commitWidth = (next: number) => {
    const w = clampInspectorWidth(next)
    setWidth(w)
    saveInspectorWidth(w)
  }
  // Dragging left widens the panel, because the panel sits on the right.
  const resizeDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { startX: e.clientX, startWidth: width, last: width }
    setResizing(true)
  }
  const resizeMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d) return
    d.last = clampInspectorWidth(d.startWidth + (d.startX - e.clientX))
    // Preview through the CSS variable, so the inspector does not re-render on every pointer move.
    panelRef.current?.style.setProperty('--inspector-w', `${d.last}px`)
  }
  const resizeEnd = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d) return
    drag.current = null
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    setResizing(false)
    if (d.last !== width) commitWidth(d.last)
  }
  const resizeKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const next =
      e.key === 'ArrowLeft' ? width + 16 : e.key === 'ArrowRight' ? width - 16 : e.key === 'Home' ? INSPECTOR_MIN : e.key === 'End' ? INSPECTOR_MAX : null
    if (next === null) return
    e.preventDefault()
    commitWidth(next)
  }

  const selectedId = useStore((s) => s.selectedId)
  const open = useStore((s) => s.inspectorOpen)
  const tab = useStore((s) => s.inspectorTab)
  const focusMode = useStore((s) => s.focusMode)
  const galaxyBesideChat = useStore((s) => s.galaxyBesideChat)
  const selectedAgent = useStore((s) => (s.selectedId ? s.agents[s.selectedId] : undefined))
  // In focus mode the chat fills the main area. Showing the galaxy again gives the chat back its own width.
  const fill = focusMode && open && !galaxyBesideChat

  // Keep the last agent around while the panel animates closed, so it does not blank out mid-transition.
  const lastAgent = useRef<AgentSummary | undefined>(undefined)
  if (selectedAgent) lastAgent.current = selectedAgent
  const present = open && !!selectedAgent
  const { mounted, shown } = usePresence(present)
  const rawAgent = selectedAgent ?? lastAgent.current
  const agent = useMemo(() => (rawAgent ? withDefaults(rawAgent) : undefined), [rawAgent])
  const agentId = agent?.id

  // Measure the selected tab so the sliding indicator can travel to it. Re-measured when the panel resizes.
  const tabEls = useRef<Partial<Record<InspectorTab, HTMLButtonElement | null>>>({})
  const [bar, setBar] = useState<{ left: number; width: number } | null>(null)
  useLayoutEffect(() => {
    const el = tabEls.current[tab]
    if (el) setBar({ left: el.offsetLeft, width: el.offsetWidth })
  }, [tab, width, shown])

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
    files: agent.fileCount,
    changes: undefined,
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
      ref={panelRef}
      className={`relative h-full overflow-hidden border-l glass-main motion-reduce:transition-none ${fill ? 'min-w-0 flex-1' : 'shrink-0'} ${
        resizing ? '' : 'transition-[width,opacity] duration-200 ease-out'
      } ${shown ? 'border-line opacity-100' : 'border-l-transparent opacity-0'}`}
      style={{ width: fill ? undefined : shown ? 'var(--inspector-w)' : 0, '--inspector-w': `${width}px` } as CSSProperties}
      aria-label={`Inspector for ${agent.name}`}
      aria-hidden={!shown}
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize inspector"
        aria-valuemin={INSPECTOR_MIN}
        aria-valuemax={INSPECTOR_MAX}
        aria-valuenow={width}
        tabIndex={shown && !fill ? 0 : -1}
        hidden={fill}
        title="Drag to resize. Double-click to reset."
        onPointerDown={resizeDown}
        onPointerMove={resizeMove}
        onPointerUp={resizeEnd}
        onPointerCancel={resizeEnd}
        onDoubleClick={() => commitWidth(INSPECTOR_DEFAULT)}
        onKeyDown={resizeKey}
        className="group/resize absolute inset-y-0 left-0 z-10 flex w-2 cursor-col-resize touch-none justify-center outline-none"
      >
        <span className="h-full w-px bg-transparent transition-colors duration-150 group-hover/resize:bg-tint/40 group-focus-visible/resize:bg-tint/50 group-active/resize:bg-tint/60" />
      </div>
      <div className="flex h-full flex-col" style={{ width: fill ? '100%' : 'var(--inspector-w)' }}>
        <Header
          agent={agent}
          fill={fill}
          focusMode={focusMode}
          galaxyBesideChat={galaxyBesideChat}
          expanded={width >= INSPECTOR_MAX - 8}
          onToggleWidth={() => commitWidth(toggleInspectorWidth(width))}
        />

        {/* The tab bar is a container, so labels depend on the inspector's own width, which the user resizes. */}
        <div role="tablist" aria-label="Inspector sections" className="@container relative flex min-w-0 shrink-0 items-center gap-0.5 border-b border-line px-3" onKeyDown={onTabKey}>
          {TABS.map((t) => {
            const selected = t.id === tab
            return (
              <button
                key={t.id}
                ref={(el) => {
                  tabEls.current[t.id] = el
                }}
                id={`inspector-tab-${t.id}`}
                role="tab"
                aria-selected={selected}
                aria-controls={PANEL_ID}
                tabIndex={selected ? 0 : -1}
                onClick={() => setInspectorTab(t.id)}
                aria-label={t.label}
                title={t.label}
                className={`group relative -mb-px flex h-9 shrink-0 items-center gap-1.5 rounded-t-md transition-colors duration-150 ${
                  selected ? 'px-2.5 text-caption font-medium text-ink' : 'px-2 text-caption text-muted hover:bg-tint/[0.04] hover:text-ink'
                }`}
              >
                <span className={`flex transition-colors duration-150 ${selected ? 'text-ink' : 'text-muted group-hover:text-ink'}`}>{TAB_ICONS[t.id]({ size: 14 })}</span>
                {/* The selected tab always names itself. The others name themselves only when the bar is wide enough for every label and count. */}
                <span className={selected ? '' : 'hidden @[440px]:inline'}>{t.label}</span>
                {counts[t.id] !== undefined && counts[t.id]! > 0 && (
                  <span className={`rounded px-1 font-mono text-label leading-4 tabular-nums ${selected ? 'bg-tint/[0.08] text-muted' : 'bg-tint/[0.05] text-faint'}`}>
                    {counts[t.id]}
                  </span>
                )}
              </button>
            )
          })}
          {/* One indicator slides between tabs instead of each tab fading its own underline. */}
          <span
            aria-hidden="true"
            className="pointer-events-none absolute -bottom-px h-[2px] rounded-full bg-ink transition-[left,width,opacity] duration-300 ease-out-expo"
            style={{ left: bar?.left ?? 0, width: bar?.width ?? 0, opacity: bar ? 1 : 0 }}
          />
        </div>

        <div
          key={tab}
          id={PANEL_ID}
          role="tabpanel"
          aria-labelledby={`inspector-tab-${tab}`}
          className="flex min-h-0 flex-1 animate-rise-in flex-col motion-reduce:animate-none"
        >
          {tab === 'overview' && <OverviewTab agent={agent} projectPath={project?.repoPath ?? ''} conflicts={projectConflicts.length} />}

          {tab === 'chat' && (
            <ChatTab key={agent.id} agent={agent} messages={detail?.messages} tools={detail?.tools} loaded={!!detail?.loaded} error={detailError} />
          )}

          {tab !== 'overview' && tab !== 'chat' && tab !== 'changes' && historyFailed && <HistoryError agentId={agent.id} message={detailError!} />}
          {tab === 'changes' && agent.projectId && <GitTab projectId={agent.projectId} agentStatus={agent.status} />}

          {tab === 'files' && !historyFailed && (
            <FilesTab
              agentId={agent.id}
              files={detail?.loaded ? detailFiles : agent.recentFiles}
              loaded={!!detail?.loaded}
              conflictPaths={new Set(projectConflicts.map((c) => c.path))}
            />
          )}
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
    recentTools: Array.isArray(a.recentTools) ? a.recentTools : [],
    subAgents: Array.isArray(a.subAgents) ? a.subAgents : [],
    usage: { ...NO_USAGE, ...(a.usage ?? {}) },
    capabilities: {
      ...NO_CAPS,
      ...(a.capabilities ?? {}),
      permissionModes: Array.isArray(a.capabilities?.permissionModes) ? a.capabilities.permissionModes : [],
    },
  }
}

// ---- header ---------------------------------------------------------------------

function Header({
  agent,
  fill,
  focusMode,
  galaxyBesideChat,
  expanded,
  onToggleWidth,
}: {
  agent: AgentSummary
  /** The chat fills the main area, so the panel width does not apply. */
  fill: boolean
  focusMode: boolean
  galaxyBesideChat: boolean
  expanded: boolean
  onToggleWidth: () => void
}) {
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
    <header className="shrink-0 border-b border-line px-4 pb-3 pt-3.5">
      <div className="flex items-center gap-2.5">
        <ProviderMark provider={agent.provider} size={32} />
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
                className="min-w-0 flex-1 rounded-md border border-line-strong bg-surface px-2 py-0.5 text-title font-semibold tracking-[-0.01em] text-ink outline-none focus:border-tint/40"
              />
            ) : (
              <>
                <h2 className="truncate text-title font-semibold tracking-[-0.01em] text-ink">{agent.name}</h2>
                <Button variant="ghost" size="sm" aria-label="Rename agent" title="Rename agent" onClick={startEdit} className="h-6 w-6 shrink-0 rounded-md px-0 text-faint">
                  <IconPencil size={12} />
                </Button>
              </>
            )}
          </div>
          <p className="truncate text-caption text-muted" title={agent.model || undefined}>
            {agent.providerName}
            {agent.model ? <span className="font-mono text-faint"> · {agent.model}</span> : null}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {focusMode && (
            <Button
              variant="ghost"
              size="sm"
              aria-label={galaxyBesideChat ? 'Hide galaxy' : 'Show galaxy'}
              aria-pressed={galaxyBesideChat}
              title={galaxyBesideChat ? 'Hide the galaxy' : 'Show the galaxy beside this conversation'}
              onClick={toggleGalaxyBesideChat}
              className={`h-7 rounded-md px-2 text-caption ${galaxyBesideChat ? 'text-ink' : 'text-muted'}`}
            >
              <IconGalaxy size={13} />
              Galaxy
            </Button>
          )}
          {!fill && (
            <Button
              variant="ghost"
              size="sm"
              aria-label={expanded ? 'Narrow chat panel' : 'Widen chat panel'}
              title={expanded ? `Narrow panel to ${INSPECTOR_DEFAULT}px` : `Widen panel to ${INSPECTOR_MAX}px`}
              onClick={onToggleWidth}
              className="h-7 w-7 rounded-md px-0 text-faint"
            >
              {expanded ? <IconCollapse size={14} /> : <IconExpand size={14} />}
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            aria-label={focusMode ? 'Exit focus mode' : 'Focus conversation'}
            aria-pressed={focusMode}
            title={focusMode ? 'Exit focus mode (Esc)' : 'Focus: full-width conversation (double-click a planet)'}
            onClick={() => setFocusMode(!focusMode)}
            className="h-7 w-7 rounded-md px-0 text-faint"
          >
            {focusMode ? <IconMinimize size={14} /> : <IconMaximize size={14} />}
          </Button>
          <Button variant="ghost" size="sm" aria-label="Close inspector" onClick={() => selectAgent(null)} className="-mr-1.5 h-7 w-7 shrink-0 rounded-md px-0">
            <IconX size={14} />
          </Button>
        </div>
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <StatusPill status={agent.status} detail={agent.statusDetail} />
        <div className="ml-auto flex items-center gap-1">
          {agent.running && caps.stop && (
            <Button variant="danger" size="sm" onClick={() => void stopAgent(agent.id)} className="h-6 px-2 text-caption">
              <IconStop size={10} />
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
        <p className="text-body leading-relaxed text-ink/90">{agent.task || 'No task yet. Send a message in Chat to give this agent work.'}</p>
        <p className="mt-2 text-caption text-muted">
          Current step: <span className="text-ink/80">{agent.statusDetail || '—'}</span>
        </p>
      </Section>

      <Section title="Activity">
        <div className="grid grid-cols-2 gap-x-2 gap-y-1.5">
          <Stat label="Runtime" value={agent.running ? elapsed(agent.runStartedAt, now) : '—'} />
          <Stat label="Turns" value={String(agent.turns)} />
          <Stat label="Tool calls" value={String(agent.toolCalls)} />
          <Stat label="Files touched" value={String(agent.fileCount)} />
        </div>
        <p className="mt-2 text-label text-faint">{agent.providerName} does not report percentage progress, so Orbit shows measured activity instead.</p>
      </Section>

      <Section title="Token usage">
        <div className="grid grid-cols-2 gap-x-2 gap-y-1.5">
          <Stat label="Input tokens" value={tokens(agent.usage.inputTokens)} />
          <Stat label="Output tokens" value={tokens(agent.usage.outputTokens)} />
          <Stat label="Cache reads" value={tokens(agent.usage.cacheReadTokens)} />
          <Stat label="Estimated cost" value={caps.cost ? usd(agent.usage.costUsd) : 'Not reported'} muted={!caps.cost} />
        </div>
      </Section>

      <Section title="Session details">
        <dl className="divide-y divide-line text-caption">
          <Row k="Provider" v={agent.providerName} />
          <Row k="Model" v={agent.model || 'Provider default'} />
          <Row k="Permissions" v={modeLabel || '—'} />
          <Row k="Workspace" v={projectPath || '—'} mono />
          <Row k="Created" v={timeAgo(agent.createdAt)} />
          <Row k="Last update" v={timeAgo(agent.updatedAt)} />
          <div className="flex items-center justify-between gap-3 py-2">
            <dt className="shrink-0 text-muted">Session</dt>
            <dd className="flex min-w-0 items-center gap-2">
              <span className="truncate font-mono text-label text-ink/80">{agent.sessionId || 'Not started yet'}</span>
              {agent.sessionId && (
                <Button variant="ghost" size="sm" onClick={() => void copySession()} aria-label="Copy session id" className="h-6 px-2 text-label">
                  {copied ? 'Copied' : 'Copy'}
                </Button>
              )}
            </dd>
          </div>
        </dl>
        {conflicts > 0 && (
          <p className="mt-3 flex items-start gap-2 text-caption text-warn-soft">
            <IconAlert size={13} className="mt-0.5" />
            This project has {plural(conflicts, 'file')} written by more than one agent. See the sidebar.
          </p>
        )}
      </Section>

      {agent.lastError && (
        <Section title="Last error">
          <p className="rounded-lg border border-danger/25 bg-danger/[0.08] px-3 py-2 font-mono text-caption leading-relaxed text-danger-soft">{agent.lastError}</p>
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
      <h3 className="mb-2 text-caption font-medium text-muted">{title}</h3>
      {children}
    </section>
  )
}

/**
 * One metric in a compact group. No box: a hairline separates it from the row below, the label sits
 * above a tabular value, and both share one left edge so the group reads as a grid.
 */
function Stat({ label, value, muted = false }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="min-w-0 border-b border-line/60 py-2">
      <div className="text-caption text-muted">{label}</div>
      <div className={`mt-0.5 truncate tabular-nums ${muted ? 'text-caption font-medium text-faint' : 'text-title font-semibold text-ink'}`}>{value}</div>
    </div>
  )
}

function Row({ k, v, mono = false }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <dt className="shrink-0 text-muted">{k}</dt>
      <dd className={`min-w-0 truncate text-right text-ink/85 ${mono ? 'font-mono text-label' : ''}`} title={v}>
        {v}
      </dd>
    </div>
  )
}

// ---- history error (shared by the tabs that need the full history) -----------------------

function HistoryError({ agentId, message }: { agentId: string; message: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
      <p className="text-body font-medium text-ink/85">Couldn’t load this agent’s history</p>
      <p className="mt-1 max-w-[280px] text-caption leading-relaxed text-faint">{message}</p>
      <Button variant="secondary" size="sm" className="mt-4" onClick={() => void loadDetail(agentId)}>
        <IconRetry size={12} />
        Try again
      </Button>
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
            className="group flex h-full w-full items-center gap-3 rounded-lg px-2.5 text-left transition-colors duration-150 hover:bg-row-hover"
          >
            <span className="relative flex h-2 w-2 shrink-0">
              {f.state === 'writing' && <span className="absolute inset-0 animate-ping rounded-full opacity-60 motion-reduce:animate-none" style={{ background: color }} />}
              <span className="relative h-2 w-2 rounded-full" style={{ background: color }} />
            </span>
            <FileIcon path={f.path} />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <span className="truncate text-body font-medium text-ink">{baseName(f.path)}</span>
                {conflictPaths.has(f.path) && <Tag tone="warn">Conflict</Tag>}
              </span>
              <span className="block truncate font-mono text-label text-faint" title={f.path}>
                {dirName(f.path) || f.path}
              </span>
            </span>
            <span className="shrink-0 text-right text-label tabular-nums text-muted">
              <span className="block">
                {f.writes ?? 0} written · {f.reads ?? 0} read
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

// ---- shared bits ----------------------------------------------------------------------------

function Loading() {
  return (
    <div className="flex flex-1 items-center justify-center text-caption text-muted" role="status">
      Loading history…
    </div>
  )
}

function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="px-6 text-center">
      <p className="text-body font-medium text-ink/80">{title}</p>
      <p className="mt-1 text-caption leading-relaxed text-faint">{body}</p>
    </div>
  )
}
