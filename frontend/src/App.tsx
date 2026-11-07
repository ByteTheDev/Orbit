import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react'
import { ContextMenu, type MenuItem } from './components/ContextMenu'
import { Dashboard } from './components/dashboard/Dashboard'
import { Dialogs } from './components/dialogs/Dialogs'
import { Inspector } from './components/inspector/Inspector'
import { UsageBar } from './components/UsageBar'
import { ProjectsPanel } from './components/ProjectsPanel'
import { Toasts } from './components/Toasts'
import { TopBar } from './components/TopBar'
import { Universe, type UniverseHandle } from './components/universe/Universe'
import { Button, EmptyState, IconChat, IconFit, IconInspect, IconMinus, IconPencil, IconPlay, IconPlus, IconResume, IconStop, IconTarget, IconTrash, Kbd, Spinner, floatingSurface } from './components/ui'
import { moveAgent, resumeAgent, stopAgent } from './lib/actions'
import { api, errorText, onEvents } from './lib/bridge'
import { TAB_KEYS } from './lib/shortcuts'
import {
  applyEvents,
  applySnapshot,
  focusAgent as storeFocus,
  getState,
  openDialog,
  selectAgent,
  setInspectorTab,
  setState,
  setSystemReducedMotion,
  useStore,
} from './lib/store'
import type { OrbitEvent } from './types'


export default function App() {
  const universeRef = useRef<UniverseHandle>(null)
  const menuOpenRef = useRef(false)
  const [menu, setMenu] = useState<{ agentId: string; x: number; y: number } | null>(null)
  const [projectMenu, setProjectMenu] = useState<{ projectId: string; x: number; y: number } | null>(null)
  const [attempt, setAttempt] = useState(0)

  const loading = useStore((s) => s.loading)
  const connected = useStore((s) => s.connected)
  const connectError = useStore((s) => s.connectError)
  const storageError = useStore((s) => s.storageError)
  const projectsOpen = useStore((s) => s.projectsOpen)
  const dashboardOpen = useStore((s) => s.dashboardOpen)
  const selectedId = useStore((s) => s.selectedId)
  const reducedMotion = useStore((s) => s.reducedMotion)
  const focus = useStore((s) => s.focus)
  const activeProjectId = useStore((s) => s.activeProjectId)
  const projectsMap = useStore((s) => s.projects)
  const projectOrder = useStore((s) => s.projectOrder)
  const agentsMap = useStore((s) => s.agents)
  const agentOrder = useStore((s) => s.agentOrder)

  const projectList = useMemo(() => projectOrder.map((id) => projectsMap[id]).filter(Boolean), [projectOrder, projectsMap])
  const agentList = useMemo(() => agentOrder.map((id) => agentsMap[id]).filter(Boolean), [agentOrder, agentsMap])
  const activeAgentCount = useMemo(() => agentList.filter((a) => a.projectId === activeProjectId).length, [agentList, activeProjectId])

  // ---- connection ---------------------------------------------------------------

  useEffect(() => {
    const off = onEvents((batch) => applyEvents(batch as OrbitEvent[]))
    let cancelled = false
    setState({ loading: true, connectError: null })
    api
      .getSnapshot()
      .then((snap) => {
        if (!cancelled) applySnapshot(snap)
      })
      .catch((err) => {
        if (!cancelled) setState({ loading: false, connected: false, connectError: errorText(err) })
      })
    return () => {
      cancelled = true
      off()
    }
  }, [attempt])

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = () => setSystemReducedMotion(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  // Focus requests from the store (sidebar, dialogs, launch) move the camera.
  useEffect(() => {
    if (focus) universeRef.current?.focusAgent(focus.id)
  }, [focus])

  // ---- shortcuts -------------------------------------------------------------------

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const typing = !!target?.closest('input, textarea, select, [contenteditable="true"]')
      const s = getState()
      const uni = universeRef.current

      if (e.key === 'Escape') {
        if (s.dialog || menuOpenRef.current) return
        if (s.dashboardOpen) {
          setState({ dashboardOpen: false })
          e.preventDefault()
          return
        }
        if (s.inspectorOpen) {
          selectAgent(null)
          e.preventDefault()
        } else if (universeRef.current?.returnToGalaxy()) {
          // Esc leaves a focused solar system for the whole galaxy.
          e.preventDefault()
        }
        return
      }
      if (typing || s.dialog || menuOpenRef.current || e.metaKey || e.ctrlKey) return

      const handled = (fn: () => void) => {
        e.preventDefault()
        fn()
      }

      // Settings can turn off single-key shortcuts. Alt+arrows stay on, since they rarely collide with typing.
      const singleKeys = s.settings.singleKeyShortcuts
      if (!singleKeys && !(e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown'))) return

      if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        const list = s.agentOrder
        if (list.length === 0) return
        const idx = list.indexOf(s.selectedId ?? '')
        const step = e.key === 'ArrowDown' ? 1 : -1
        const next = list[(idx + step + list.length) % list.length]
        return handled(() => {
          selectAgent(next, { openInspector: true })
          storeFocus(next)
        })
      }

      switch (e.key) {
        case 'n':
        case 'N':
          return handled(() => openDialog(s.projectOrder.length ? { kind: 'launch' } : { kind: 'project' }))
        case 'p':
        case 'P':
          return handled(() => openDialog({ kind: 'project' }))
        case '?':
          return handled(() => openDialog({ kind: 'settings', section: 'keyboard' }))
        case ',':
          return handled(() => openDialog({ kind: 'settings' }))
        case '[':
          return handled(() => setState((x) => ({ projectsOpen: !x.projectsOpen })))
        case 'd':
        case 'D':
          return handled(() => setState((x) => ({ dashboardOpen: !x.dashboardOpen })))
        case 'b':
        case 'B':
          return handled(() => openDialog({ kind: 'browser' }))
        case ']':
          return handled(() => {
            if (s.selectedId) setState((x) => ({ inspectorOpen: !x.inspectorOpen }))
          })
        case '0':
          return handled(() => uni?.fit())
        case 'f':
        case 'F':
          return handled(() => {
            if (s.selectedId) uni?.focusAgent(s.selectedId)
            else uni?.fit()
          })
        case '+':
        case '=':
          return handled(() => uni?.zoomBy(1.2))
        case '-':
        case '_':
          return handled(() => uni?.zoomBy(1 / 1.2))
        case 'ArrowLeft':
        case 'ArrowRight':
        case 'ArrowUp':
        case 'ArrowDown': {
          const d = e.shiftKey ? 240 : 80
          const dx = e.key === 'ArrowLeft' ? d : e.key === 'ArrowRight' ? -d : 0
          const dy = e.key === 'ArrowUp' ? d : e.key === 'ArrowDown' ? -d : 0
          return handled(() => uni?.pan(dx, dy))
        }
        default:
          if (/^[1-6]$/.test(e.key) && Number(e.key) <= TAB_KEYS.length && s.inspectorOpen) {
            return handled(() => setInspectorTab(TAB_KEYS[Number(e.key) - 1]))
          }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // ---- menus -----------------------------------------------------------------------

  const openMenu = (agentId: string, x: number, y: number) => {
    menuOpenRef.current = true
    setMenu({ agentId, x, y })
  }
  const closeMenu = () => {
    menuOpenRef.current = false
    setMenu(null)
  }
  const openProjectMenu = (projectId: string, x: number, y: number) => {
    menuOpenRef.current = true
    setProjectMenu({ projectId, x, y })
  }
  const closeProjectMenu = () => {
    menuOpenRef.current = false
    setProjectMenu(null)
  }

  // ---- render --------------------------------------------------------------------------

  if (loading && !connected) {
    return (
      <div className="flex h-full items-center justify-center bg-canvas">
        <Spinner label="Starting Orbit…" />
      </div>
    )
  }

  if (!connected && connectError) {
    return (
      <div className="flex h-full items-center justify-center bg-canvas p-8">
        <EmptyState
          title="Orbit can’t reach its backend"
          body={`${connectError}. Orbit needs to run inside the desktop app (wails dev or the built executable), not in a plain browser tab.`}
          action={
            <Button variant="secondary" onClick={() => setAttempt((n) => n + 1)}>
              Try again
            </Button>
          }
        />
      </div>
    )
  }

  const menuProject = projectMenu ? getState().projects[projectMenu.projectId] : undefined
  const projectMenuItems: MenuItem[] = menuProject
    ? [
        {
          label: 'Change icon…',
          icon: <IconPencil size={14} />,
          onSelect: () => openDialog({ kind: 'projectIcon', projectId: menuProject.id }),
        },
        {
          label: 'Launch agent here…',
          icon: <IconPlus size={14} />,
          onSelect: () => openDialog({ kind: 'launch', projectId: menuProject.id }),
        },
        {
          label: 'Remove project…',
          icon: <IconTrash size={14} />,
          onSelect: () => openDialog({ kind: 'deleteProject', projectId: menuProject.id }),
          danger: true,
        },
      ]
    : []

  const menuAgent = menu ? agentsMap[menu.agentId] : undefined
  const menuItems: MenuItem[] = menuAgent
    ? [
        {
          label: 'Inspect',
          icon: <IconInspect size={14} />,
          onSelect: () => selectAgent(menuAgent.id, { openInspector: true }),
        },
        { label: 'Focus in universe', icon: <IconTarget size={14} />, onSelect: () => universeRef.current?.focusAgent(menuAgent.id), hint: 'F' },
        {
          label: 'Open chat',
          icon: <IconChat size={14} />,
          onSelect: () => {
            selectAgent(menuAgent.id, { openInspector: true })
            setInspectorTab('chat')
          },
        },
        ...(menuAgent.running && menuAgent.capabilities.stop
          ? [{ label: 'Stop', icon: <IconStop size={13} />, onSelect: () => void stopAgent(menuAgent.id), danger: true }]
          : []),
        ...(!menuAgent.running && menuAgent.capabilities.resume && menuAgent.turns > 0
          ? [{ label: 'Resume session', icon: <IconResume size={14} />, onSelect: () => void resumeAgent(menuAgent.id) }]
          : []),
        {
          label: 'Remove agent…',
          icon: <IconTrash size={14} />,
          onSelect: () => openDialog({ kind: 'remove', agentId: menuAgent.id }),
          danger: true,
        },
      ]
    : []

  return (
    <div className="flex h-full flex-col bg-canvas text-ink">
      <TopBar />
      {storageError && (
        <div className="shrink-0 border-b border-warn/20 bg-warn/[0.07] px-4 py-2 text-[12px] text-warn-soft" role="alert">
          Orbit could not save its state: {storageError}. Recent changes may be lost on exit.
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {projectsOpen && (
          <ProjectsPanel
            onFocusProject={(id) => {
              setState({ activeProjectId: id })
              universeRef.current?.focusProject(id)
            }}
            onFocusAgent={(id) => universeRef.current?.focusAgent(id)}
            onOpenAgentMenu={openMenu}
          />
        )}

        <main className="relative min-w-0 flex-1" aria-label="Universe">
          <Universe
            ref={universeRef}
            projects={projectList}
            agents={agentList}
            selectedId={selectedId}
            reducedMotion={reducedMotion}
            onSelectAgent={(id) => selectAgent(id, { openInspector: true })}
            onSelectProject={(id) => setState({ activeProjectId: id })}
            onOpenMenu={openMenu}
            onOpenProjectMenu={openProjectMenu}
            onMovePlanet={(id, x, y) => void moveAgent(id, x, y)}
          />

          {dashboardOpen && <Dashboard />}

          {projectList.length === 0 && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-8">
              <div className="pointer-events-auto">
                <EmptyState
                  icon={<OrbitIllustration />}
                  title="Create a project to begin"
                  body="A project is a repository folder. Agents orbit their project’s sun, and the commands they run orbit as rocks."
                  action={
                    <Button variant="primary" onClick={() => openDialog({ kind: 'project' })} className="rounded-full px-4">
                      <IconPlus size={13} />
                      New project <Kbd>P</Kbd>
                    </Button>
                  }
                />
              </div>
            </div>
          )}

          {projectList.length > 0 && activeAgentCount === 0 && (
            <div className="pointer-events-none absolute inset-x-0 bottom-8 flex justify-center">
              <div className={`pointer-events-auto flex animate-float-in items-center gap-5 rounded-2xl py-3 pl-5 pr-3 ${floatingSurface}`}>
                <div className="text-[13px]">
                  <p className="font-semibold text-ink">No agents in {projectsMap[activeProjectId ?? '']?.name ?? 'this project'}</p>
                  <p className="mt-0.5 text-[12px] text-muted">Launch one to see it orbit here.</p>
                </div>
                <Button variant="primary" size="sm" onClick={() => openDialog({ kind: 'launch', projectId: activeProjectId ?? undefined })} className="rounded-full px-3.5">
                  <span className="inline-flex animate-hint-nudge">
                    <IconPlay size={11} />
                  </span>
                  Launch agent <Kbd>N</Kbd>
                </Button>
              </div>
            </div>
          )}

          <div className={`absolute bottom-4 right-4 flex items-center rounded-full p-1 ${floatingSurface}`}>
            <Button variant="ghost" size="sm" aria-label="Zoom out" onClick={() => universeRef.current?.zoomBy(1 / 1.25)} className="h-7 w-7 rounded-full px-0">
              <IconMinus size={14} />
            </Button>
            <Button variant="ghost" size="sm" aria-label="Fit all projects" onClick={() => universeRef.current?.fit()} className="h-7 rounded-full px-3 text-[12px]">
              <IconFit size={13} />
              Fit
            </Button>
            <Button variant="ghost" size="sm" aria-label="Zoom in" onClick={() => universeRef.current?.zoomBy(1.25)} className="h-7 w-7 rounded-full px-0">
              <IconPlus size={14} />
            </Button>
          </div>

          {agentList.length > 0 && (
            <p className="pointer-events-none absolute right-4 top-4 rounded-full bg-black/30 px-3 py-1 text-[11px] text-faint backdrop-blur-sm">
              Drag to pan · scroll to zoom · right-click a planet
            </p>
          )}
        </main>

        {/* Always mounted: the inspector animates itself in and out, and renders nothing when closed. */}
        <Inspector />
      </div>

      {/* Loaded on demand: the terminal engine is large, and most sessions never open it. */}
      <Suspense fallback={<div className="h-8 shrink-0 border-t border-line bg-sidebar" aria-hidden="true" />}>
        <TerminalPanel />
      </Suspense>

      {/* Always at the very bottom of the window, below the terminal. */}
      <UsageBar />

      <Dialogs />
      <Toasts />
      {menu && menuAgent && <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={closeMenu} label={`Actions for ${menuAgent.name}`} />}
      {projectMenu && menuProject && (
        <ContextMenu x={projectMenu.x} y={projectMenu.y} items={projectMenuItems} onClose={closeProjectMenu} label={`Actions for ${menuProject.name}`} />
      )}
    </div>
  )
}

const TerminalPanel = lazy(() => import('./components/terminal/TerminalPanel').then((m) => ({ default: m.TerminalPanel })))

function OrbitIllustration() {
  return (
    <svg width="72" height="72" viewBox="0 0 72 72" aria-hidden="true" fill="none">
      <ellipse cx="36" cy="36" rx="32" ry="12" stroke="rgba(244,244,245,0.16)" strokeWidth="1" strokeDasharray="2 4" transform="rotate(-18 36 36)" />
      <ellipse cx="36" cy="36" rx="20" ry="7.5" stroke="rgba(244,244,245,0.1)" strokeWidth="1" transform="rotate(-18 36 36)" />
      <circle cx="36" cy="36" r="8" fill="rgba(244,244,245,0.1)" />
      <circle cx="58" cy="25" r="3.2" style={{ fill: 'var(--color-claude)' }} />
    </svg>
  )
}

