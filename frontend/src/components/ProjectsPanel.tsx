import { useMemo, useState, type KeyboardEvent } from 'react'
import { useStore, openDialog, setState, toast } from '../lib/store'
import { errorText } from '../lib/bridge'
import type { AgentSummary } from '../types'
import { ContextMenu, type MenuItem } from './ContextMenu'
import { ProjectItem } from './navigation/ProjectItem'
import { buildNavProjects, groupAgents, normaliseQuery } from './navigation/projectFilter'
import { Tooltip } from './navigation/Tooltip'
import { Button, IconAlert, IconPencil, IconPlus, IconTrash, IconFolder } from './ui'

interface Props {
  onFocusProject: (projectId: string) => void
  onFocusAgent: (agentId: string) => void
}

interface MenuState {
  projectId: string
  x: number
  y: number
}

/**
 * Left panel: every project as an expandable group, a filter for long lists, and the
 * active project's file conflicts. Arrow keys move through the list; Left and Right
 * collapse and expand a project.
 */
export function ProjectsPanel({ onFocusProject, onFocusAgent }: Props) {
  const projectOrder = useStore((s) => s.projectOrder)
  const projects = useStore((s) => s.projects)
  const activeId = useStore((s) => s.activeProjectId)
  const agents = useStore((s) => s.agents)
  const agentOrder = useStore((s) => s.agentOrder)
  const selectedId = useStore((s) => s.selectedId)
  const loading = useStore((s) => s.loading)

  const [query, setQuery] = useState('')
  // Only changes the user has made. Otherwise a project is expanded when it is the active one.
  const [overrides, setOverrides] = useState<Record<string, boolean>>({})
  const [menu, setMenu] = useState<MenuState | null>(null)

  const filtering = normaliseQuery(query) !== ''
  const agentsByProject = useMemo(
    () => groupAgents(agentOrder.map((id) => agents[id]).filter((a): a is AgentSummary => !!a)),
    [agentOrder, agents],
  )
  const rows = useMemo(() => buildNavProjects(projectOrder, projects, agentsByProject, query), [projectOrder, projects, agentsByProject, query])

  const isExpanded = (id: string) => (filtering ? true : (overrides[id] ?? id === activeId))
  const toggle = (id: string) => setOverrides((prev) => ({ ...prev, [id]: !isExpanded(id) }))

  const activeProject = activeId ? projects[activeId] : undefined
  const menuProject = menu ? projects[menu.projectId] : undefined

  const selectProject = (id: string) => {
    setState({ activeProjectId: id })
    setOverrides((prev) => ({ ...prev, [id]: true }))
    onFocusProject(id)
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

  return (
    <aside className="flex h-full w-[272px] shrink-0 flex-col border-r border-line bg-sidebar max-[900px]:w-[236px]" aria-label="Projects">
      <header className="flex items-center justify-between gap-2 px-4 pb-2.5 pt-4">
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-faint">Projects</h2>
          <span className="rounded-md bg-white/[0.05] px-1.5 py-px text-[10px] font-medium tabular-nums text-muted" aria-label={`${projectOrder.length} projects`}>
            {loading && projectOrder.length === 0 ? '…' : projectOrder.length}
          </span>
        </div>
        <Tooltip label="New project" shortcut="P" align="end">
          <Button variant="secondary" size="sm" onClick={() => openDialog({ kind: 'project' })} aria-label="New project" className="h-7 rounded-full px-3">
            <IconPlus size={12} />
            New
          </Button>
        </Tooltip>
      </header>

      {projectOrder.length > 0 && (
        <div className="px-3 pb-2">
          <label className="relative block">
            <span className="sr-only">Filter projects and agents</span>
            <SearchIcon />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape' && query) {
                  e.preventDefault()
                  e.stopPropagation()
                  setQuery('')
                }
              }}
              placeholder="Filter projects and agents"
              className="h-8 w-full rounded-md border border-line bg-surface/60 pl-8 pr-2.5 text-[12px] text-ink placeholder:text-faint outline-none transition-[border-color,background-color,box-shadow] duration-150 hover:border-line-strong focus:border-white/30 focus:bg-canvas focus:ring-[3px] focus:ring-white/[0.07] [&::-webkit-search-cancel-button]:hidden"
            />
          </label>
        </div>
      )}

      <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-3" aria-label="Project list" aria-busy={loading && projectOrder.length === 0} onKeyDown={onNavKey}>
        {loading && projectOrder.length === 0 && <SkeletonRows />}

        {!loading && projectOrder.length === 0 && (
          <div className="flex flex-col items-center px-4 pb-6 pt-10 text-center">
            <span className="mb-3 flex h-10 w-10 items-center justify-center rounded-full border border-line text-faint">
              <IconFolder size={16} />
            </span>
            <p className="text-[13px] font-medium text-ink">No projects yet</p>
            <p className="mt-1 text-[12px] leading-relaxed text-faint">A project is a repository folder. Agents work inside one.</p>
            <Button variant="secondary" size="sm" onClick={() => openDialog({ kind: 'project' })} className="mt-4 rounded-full px-3.5">
              <IconPlus size={12} />
              Add a project
            </Button>
          </div>
        )}

        {projectOrder.length > 0 && rows.length === 0 && (
          <div className="px-4 py-10 text-center">
            <p className="text-[13px] text-ink/85">No matches for “{query.trim()}”</p>
            <button type="button" onClick={() => setQuery('')} className="mt-2 text-[12px] text-muted underline-offset-4 hover:text-ink hover:underline">
              Clear filter
            </button>
          </div>
        )}

        {rows.length > 0 && (
          <ul role="list" className="space-y-0.5">
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
              />
            ))}
          </ul>
        )}

        {!filtering && activeProject && activeProject.conflicts.length > 0 && <ConflictList conflicts={activeProject.conflicts} />}
      </nav>

      <footer className="border-t border-line px-4 py-2.5">
        <p className="text-[11px] leading-relaxed text-faint">Orbit runs agents through the Claude Code and Codex CLIs.</p>
      </footer>

      {menu && menuProject && (
        <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} label={`Actions for ${menuProject.name}`} />
      )}
    </aside>
  )
}

async function copyPath(path: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(path)
    toast('Repository path copied', 'success')
  } catch (err) {
    toast(errorText(err), 'error')
  }
}

function SearchIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      aria-hidden="true"
      className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint"
    >
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-4.2-4.2" />
    </svg>
  )
}

/** Placeholder rows shown while the first snapshot loads. Same height as real rows, so nothing jumps. */
function SkeletonRows() {
  return (
    <ul className="space-y-1 px-1 pt-1" aria-label="Loading projects">
      {[0, 1, 2].map((i) => (
        <li key={i} className="flex items-center gap-2.5 px-2 py-2">
          <span className="h-7 w-7 shrink-0 animate-pulse rounded-full bg-white/[0.06] motion-reduce:animate-none" />
          <span className="min-w-0 flex-1 space-y-1.5">
            <span className="block h-2.5 w-2/3 animate-pulse rounded bg-white/[0.07] motion-reduce:animate-none" />
            <span className="block h-2 w-1/2 animate-pulse rounded bg-white/[0.04] motion-reduce:animate-none" />
          </span>
        </li>
      ))}
    </ul>
  )
}

function ConflictList({ conflicts }: { conflicts: { path: string; agents: { id: string; name: string }[] }[] }) {
  return (
    <section className="mx-1 mt-4 rounded-lg bg-warn/[0.06] p-3" aria-label="Possible conflicts">
      <h3 className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold text-warn-soft">
        <IconAlert size={12} />
        Possible conflicts
      </h3>
      <ul className="space-y-2">
        {conflicts.map((c) => (
          <li key={c.path} className="text-[12px]">
            <span className="block truncate font-mono text-[11px] text-ink/85" title={c.path}>
              {c.path}
            </span>
            <span className="block truncate text-[11px] text-faint">Written by {c.agents.map((a) => a.name).join(', ')}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
