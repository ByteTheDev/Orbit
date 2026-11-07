import { useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useStore, openDialog, setSidebar, setSidebarView, setState, toast } from '../lib/store'
import { errorText } from '../lib/bridge'
import { SIDEBAR_RAIL, SIDEBAR_VIEWS, type SidebarView } from '../lib/sidebarPrefs'
import { useWatchProject } from '../lib/repoState'
import { isResolved, markResolved } from '../lib/conflictResolution'
import type { AgentSummary } from '../types'
import { ContextMenu, type MenuItem } from './ContextMenu'
import { ActiveAgents } from './navigation/ActiveAgents'
import { agentBucket, type AgentBucket } from './navigation/agentStatus'
import { ProjectItem } from './navigation/ProjectItem'
import { ProjectRail } from './navigation/ProjectRail'
import { ResizeHandle } from './navigation/ResizeHandle'
import { SidebarFilters } from './navigation/SidebarFilters'
import { Tooltip } from './navigation/Tooltip'
import { buildNavProjects, groupAgents, isFiltering, providersIn, type NavFilter } from './navigation/projectFilter'
import { Button, IconAlert, IconPencil, IconPlus, IconTrash, IconFolder, IconSidebar } from './ui'
import { FileIcon } from './ui/FileIcon'
import { OutlinedIcon } from './ui/OutlinedIcon'
import { FilesView } from './files/FilesView'
import { GitView } from './git/GitView'

const VIEW_META: Record<SidebarView, { title: string; icon: string; label: string }> = {
  projects: { title: 'Projects', icon: 'dashboard', label: 'Projects' },
  files: { title: 'Files', icon: 'folder', label: 'Files' },
  git: { title: 'Source control', icon: 'call_split', label: 'Git' },
}

interface Props {
  onFocusProject: (projectId: string) => void
  onFocusAgent: (agentId: string) => void
  onOpenAgentMenu: (agentId: string, x: number, y: number) => void
}

interface MenuState {
  projectId: string
  x: number
  y: number
}

const EMPTY_COUNTS: Record<AgentBucket, number> = { running: 0, attention: 0, done: 0, idle: 0 }

/**
 * Left panel: a command centre for projects and agents. From the top: a count and collapse
 * control, search with status and provider chips, an Active strip of agents that are running or
 * need attention, then the project hierarchy with its conflicts. The panel resizes from its right
 * edge and can collapse to a rail of project marks. Arrow keys move through the list; Left and
 * Right collapse and expand a project.
 */
export function ProjectsPanel({ onFocusProject, onFocusAgent, onOpenAgentMenu }: Props) {
  const projectOrder = useStore((s) => s.projectOrder)
  const projects = useStore((s) => s.projects)
  const activeId = useStore((s) => s.activeProjectId)
  const agents = useStore((s) => s.agents)
  const agentOrder = useStore((s) => s.agentOrder)
  const selectedId = useStore((s) => s.selectedId)
  const loading = useStore((s) => s.loading)
  const sidebarWidth = useStore((s) => s.sidebarWidth)
  const collapsed = useStore((s) => s.sidebarCollapsed)
  const view = useStore((s) => s.sidebarView)
  const expandedDirs = useStore((s) => (activeId ? s.explorerExpanded[activeId] : undefined))
  // The watcher always covers the active project's root and git metadata; the Files view adds its open folders.
  useWatchProject(activeId, view === 'files' ? expandedDirs ?? [] : [])

  const [query, setQuery] = useState('')
  const [provider, setProvider] = useState<string | null>(null)
  const [bucket, setBucket] = useState<AgentBucket | null>(null)
  // Only changes the user has made. Otherwise a project is expanded when it is the active one.
  const [overrides, setOverrides] = useState<Record<string, boolean>>({})
  const [menu, setMenu] = useState<MenuState | null>(null)
  const asideRef = useRef<HTMLElement>(null)

  const agentList = useMemo(() => agentOrder.map((id) => agents[id]).filter((a): a is AgentSummary => !!a), [agentOrder, agents])
  const agentsByProject = useMemo(() => groupAgents(agentList), [agentList])
  const providers = useMemo(() => providersIn(agentList), [agentList])
  const bucketCounts = useMemo(() => {
    const counts = { ...EMPTY_COUNTS }
    for (const a of agentList) counts[agentBucket(a.status)]++
    return counts
  }, [agentList])

  const filter: NavFilter = useMemo(() => ({ query, provider, bucket }), [query, provider, bucket])
  const filtering = isFiltering(filter)
  const rows = useMemo(() => buildNavProjects(projectOrder, projects, agentsByProject, filter), [projectOrder, projects, agentsByProject, filter])

  const isExpanded = (id: string) => (filtering ? true : (overrides[id] ?? id === activeId))
  const toggle = (id: string) => setOverrides((prev) => ({ ...prev, [id]: !isExpanded(id) }))

  const activeProject = activeId ? projects[activeId] : undefined
  const menuProject = menu ? projects[menu.projectId] : undefined

  const selectProject = (id: string) => {
    setState({ activeProjectId: id })
    setOverrides((prev) => ({ ...prev, [id]: true }))
    onFocusProject(id)
  }

  const resetFilters = () => {
    setQuery('')
    setProvider(null)
    setBucket(null)
  }

  const onNavKey = (e: KeyboardEvent<HTMLElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return
    const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[data-nav-item]:not(:disabled)'))
    if (items.length === 0) return
    const idx = items.indexOf(document.activeElement as HTMLElement)
    let next = 0
    if (e.key === 'ArrowDown') next = idx < 0 ? 0 : Math.min(items.length - 1, idx + 1)
    if (e.key === 'ArrowUp') next = idx < 0 ? items.length - 1 : Math.max(0, idx - 1)
    if (e.key === 'End') next = items.length - 1
    e.preventDefault()
    items[next].focus()
  }

  const menuItems: MenuItem[] = menuProject
    ? [
        { label: 'Change icon…', icon: <IconPencil size={14} />, onSelect: () => openDialog({ kind: 'projectIcon', projectId: menuProject.id }) },
        { label: 'Launch agent here…', icon: <IconPlus size={14} />, onSelect: () => openDialog({ kind: 'launch', projectId: menuProject.id }) },
        { label: 'Copy repository path', icon: <IconFolder size={14} />, onSelect: () => void copyPath(menuProject.repoPath) },
        { label: 'Remove project…', icon: <IconTrash size={14} />, onSelect: () => openDialog({ kind: 'deleteProject', projectId: menuProject.id }), danger: true },
      ]
    : []

  const railRows = useMemo(
    () =>
      projectOrder
        .map((id) => projects[id])
        .filter((p): p is NonNullable<typeof p> => !!p)
        .map((project) => ({ project, agents: agentsByProject.get(project.id) ?? [] })),
    [projectOrder, projects, agentsByProject],
  )

  const countLabel = filtering ? `${rows.length} of ${projectOrder.length}` : `${projectOrder.length}`

  return (
    <aside
      ref={asideRef}
      style={{ width: collapsed ? SIDEBAR_RAIL : sidebarWidth }}
      className="relative z-10 flex h-full max-w-[60vw] shrink-0 animate-slide-in-left flex-col border-r border-line glass-sidebar"
      aria-label="Projects"
    >
      {collapsed ? (
        <ProjectRail
          rows={railRows}
          activeId={activeId}
          onSelect={onFocusProject}
          onExpand={() => setSidebar({ collapsed: false })}
          onKeyDown={onNavKey}
        />
      ) : (
        <>
          <header className="flex items-center justify-between gap-2 px-3 pb-2 pt-3">
            <div className="flex min-w-0 items-baseline gap-2">
              <h2 className="text-label font-semibold uppercase tracking-[0.12em] text-muted">{VIEW_META[view].title}</h2>
              {view !== 'projects' && activeProject && <span className="min-w-0 truncate text-label text-faint">{activeProject.name}</span>}
              {view === 'projects' && projectOrder.length > 0 && (
                <span className="text-label font-medium tabular-nums text-faint" aria-label={`${countLabel} projects shown`}>
                  {loading && projectOrder.length === 0 ? '…' : countLabel}
                </span>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-0.5">
              <button
                type="button"
                onClick={() => setSidebar({ collapsed: true })}
                aria-label="Collapse sidebar"
                title="Collapse sidebar"
                className="flex h-7 w-7 items-center justify-center rounded-md text-faint transition-colors duration-150 hover:bg-tint/[0.06] hover:text-ink"
              >
                <IconSidebar size={13} />
              </button>
              {view === 'projects' && (
              <Tooltip label="New project" shortcut="P" align="end">
                <Button variant="ghost" size="sm" onClick={() => openDialog({ kind: 'project' })} aria-label="New project" className="-mr-1.5 h-7 gap-1 rounded-md px-2 text-caption text-muted hover:text-ink">
                  <IconPlus size={11} />
                  New
                </Button>
              </Tooltip>
              )}
            </div>
          </header>

          <div role="tablist" aria-label="Sidebar view" className="mx-3 mb-2 flex items-center gap-0.5 rounded-lg bg-tint/[0.035] p-0.5">
            {SIDEBAR_VIEWS.map((v) => (
              <Tooltip key={v} label={VIEW_META[v].label} align="start">
                <button
                  type="button"
                  role="tab"
                  aria-selected={view === v}
                  aria-label={VIEW_META[v].label}
                  onClick={() => setSidebarView(v)}
                  className={`flex h-7 flex-1 items-center justify-center gap-1.5 rounded-md text-caption transition-[background-color,color] duration-150 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-tint/[0.2] ${
                    view === v ? 'bg-tint/[0.09] text-ink shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]' : 'text-faint hover:text-muted'
                  }`}
                >
                  <OutlinedIcon name={VIEW_META[v].icon} size={14} />
                  <span className="hidden min-[300px]:inline">{VIEW_META[v].label}</span>
                </button>
              </Tooltip>
            ))}
          </div>

          {view === 'projects' && projectOrder.length > 0 && (
            <SidebarFilters
              query={query}
              onQuery={setQuery}
              provider={provider}
              providers={providers}
              onProvider={setProvider}
              bucket={bucket}
              bucketCounts={bucketCounts}
              total={agentList.length}
              onBucket={setBucket}
              onReset={resetFilters}
            />
          )}

          {view === 'projects' && !filtering && projectOrder.length > 0 && <ActiveAgents agents={agentList} projects={projects} selectedId={selectedId} onFocusAgent={onFocusAgent} />}

          {view === 'files' && (activeId ? <FilesView key={activeId} projectId={activeId} /> : <NoProject text="Choose a project to see its files." />)}
          {view === 'git' && (activeId ? <GitView key={activeId} projectId={activeId} /> : <NoProject text="Choose a project to see its source control." />)}
          {view === 'projects' && <nav className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-1.5 pb-2" aria-label="Project list" aria-busy={loading && projectOrder.length === 0} onKeyDown={onNavKey}>
            {loading && projectOrder.length === 0 && <SkeletonRows />}

            {!loading && projectOrder.length === 0 && (
              <div className="flex flex-col items-center px-5 pb-6 pt-12 text-center">
                <span className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl border border-line bg-tint/[0.02] text-faint">
                  <IconFolder size={16} />
                </span>
                <p className="text-body font-semibold text-ink">No projects yet</p>
                <p className="mt-1.5 text-caption leading-relaxed text-muted">A project is a repository folder. Agents work inside one.</p>
                <Button variant="secondary" size="sm" onClick={() => openDialog({ kind: 'project' })} className="mt-5 rounded-full px-3.5">
                  <IconPlus size={11} />
                  Add a project
                </Button>
              </div>
            )}

            {projectOrder.length > 0 && rows.length === 0 && (
              <div className="px-4 py-12 text-center">
                <p className="text-body text-ink/85">{query.trim() ? `No matches for “${query.trim()}”` : 'Nothing matches these filters'}</p>
                <button type="button" onClick={resetFilters} className="mt-2 text-caption text-muted underline-offset-4 transition-colors hover:text-ink hover:underline">
                  Clear search and filters
                </button>
              </div>
            )}

            {rows.length > 0 && (
              <ul role="list" className="space-y-px">
                {rows.map((row) => (
                  <ProjectItem
                    key={row.project.id}
                    nav={row}
                    active={row.project.id === activeId}
                    expanded={isExpanded(row.project.id)}
                    selectedAgentId={selectedId}
                    onToggle={() => toggle(row.project.id)}
                    onSelect={() => selectProject(row.project.id)}
                    onFocusAgent={onFocusAgent}
                    onContextMenu={(x, y) => setMenu({ projectId: row.project.id, x, y })}
                    onAgentContextMenu={onOpenAgentMenu}
                  />
                ))}
              </ul>
            )}

            {!filtering && activeProject && activeProject.conflicts.length > 0 && (
              <ConflictList projectId={activeProject.id} conflicts={activeProject.conflicts} />
            )}
          </nav>}

          <ResizeHandle
            width={sidebarWidth}
            onPreview={(w) => {
              if (asideRef.current) asideRef.current.style.width = `${w}px`
            }}
            onCommit={(w) => setSidebar({ width: w })}
          />
        </>
      )}

      {menu && menuProject && (
        <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} label={`Actions for ${menuProject.name}`} />
      )}
    </aside>
  )
}

function NoProject({ text }: { text: string }) {
  return <p className="px-5 py-10 text-center text-caption text-muted">{text}</p>
}

async function copyPath(path: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(path)
    toast('Repository path copied', 'success')
  } catch (err) {
    toast(errorText(err), 'error')
  }
}

/** Placeholder rows shown while the first snapshot loads. Same height as real rows, so nothing jumps. */
function SkeletonRows() {
  return (
    <ul className="space-y-1 px-1 pt-1" aria-label="Loading projects">
      {[0, 1, 2].map((i) => (
        <li key={i} className="flex items-center gap-2.5 px-2 py-2">
          <span className="h-7 w-7 shrink-0 animate-pulse rounded-full bg-tint/[0.06] motion-reduce:animate-none" />
          <span className="min-w-0 flex-1 space-y-1.5">
            <span className="block h-2.5 w-2/3 animate-pulse rounded bg-tint/[0.07] motion-reduce:animate-none" />
            <span className="block h-2 w-1/2 animate-pulse rounded bg-tint/[0.04] motion-reduce:animate-none" />
          </span>
        </li>
      ))}
    </ul>
  )
}

/** localStorage, or undefined where storage is blocked. */
function safeStorage(): Storage | undefined {
  try {
    return window.localStorage
  } catch {
    return undefined
  }
}

function ConflictList({ projectId, conflicts }: { projectId: string; conflicts: { path: string; agents: { id: string; name: string }[] }[] }) {
  // Bumped on dismiss so the component re-reads the stored state and hides itself.
  const [, setTick] = useState(0)
  if (isResolved(safeStorage(), projectId, conflicts)) return null
  const resolveAll = () => {
    markResolved(safeStorage(), projectId, conflicts)
    setTick((n) => n + 1)
  }
  return (
    <section className="mx-1.5 mt-3 rounded-md bg-warn/[0.06] px-2.5 py-2" aria-label="Possible conflicts">
      <h3 className="mb-2 flex items-center gap-1.5 text-label font-semibold text-warn-soft">
        <IconAlert size={11} />
        Possible conflicts
      </h3>
      <Button size="sm" variant="ghost" className="mb-2 w-full" onClick={resolveAll}>
        Resolve all conflicts
      </Button>
      <ul className="space-y-2">
        {conflicts.map((c) => (
          <li key={c.path} className="text-caption">
            <span className="flex min-w-0 items-center gap-2">
              <FileIcon path={c.path} size={14} />
              <span className="block truncate font-mono text-label text-ink/85" title={c.path}>
                {c.path}
              </span>
            </span>
            <span className="block truncate text-label text-faint">Written by {c.agents.map((a) => a.name).join(', ')}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
