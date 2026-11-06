import { useStore, openDialog, setState } from '../lib/store'
import { Button, IconGrid, IconKeyboard, IconPlus, IconSidebar, Kbd } from './ui'
import { Tooltip } from './navigation/Tooltip'

/** Top bar: brand, a live summary, and the global actions. Labels fold into icons on narrow windows. */
export function TopBar() {
  const agents = useStore((s) => s.agentOrder.length)
  const running = useStore((s) => Object.values(s.agents).filter((a) => a.running).length)
  const conflicts = useStore((s) => Object.values(s.projects).reduce((n, p) => n + p.conflicts.length, 0))
  const projectsOpen = useStore((s) => s.projectsOpen)
  const dashboardOpen = useStore((s) => s.dashboardOpen)
  const hasProjects = useStore((s) => s.projectOrder.length > 0)
  const loading = useStore((s) => s.loading)

  const summary = loading && !hasProjects
    ? 'Loading…'
    : agents === 0
      ? 'No agents running'
      : `${agents} agent${agents === 1 ? '' : 's'} · ${running} running${conflicts ? ` · ${conflicts} conflicting file${conflicts === 1 ? '' : 's'}` : ''}`
  const live = running > 0

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line bg-canvas/80 px-4 backdrop-blur-md">
      <Tooltip label={projectsOpen ? 'Hide projects' : 'Show projects'} shortcut="[" align="start">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setState((s) => ({ projectsOpen: !s.projectsOpen }))}
          aria-label={projectsOpen ? 'Hide projects' : 'Show projects'}
          aria-pressed={projectsOpen}
          className="h-8 w-8 px-0"
        >
          <IconSidebar size={16} />
        </Button>
      </Tooltip>

      <div className="flex shrink-0 items-center gap-2.5 pl-1">
        <OrbitMark />
        <span className="text-[14px] font-semibold tracking-[-0.01em] text-ink max-[760px]:sr-only">Orbit</span>
      </div>

      <div className="flex min-w-0 flex-1 justify-center" aria-live="polite">
        <div className="inline-flex max-w-full items-center gap-2 rounded-full border border-line bg-white/[0.03] px-3 py-1 text-[12px] tabular-nums text-muted">
          <span className="relative flex h-1.5 w-1.5 shrink-0">
            {live && <span className="absolute inset-0 animate-ping rounded-full bg-status-thinking/60 motion-reduce:animate-none" />}
            <span className="relative h-1.5 w-1.5 rounded-full" style={{ background: live ? 'var(--color-status-thinking)' : 'var(--color-faint)' }} />
          </span>
          <span className="truncate">{summary}</span>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        <Tooltip label="Dashboard" shortcut="D" align="end">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setState((s) => ({ dashboardOpen: !s.dashboardOpen }))}
            aria-pressed={dashboardOpen}
            aria-label="Toggle dashboard"
            className={`text-muted ${dashboardOpen ? 'bg-white/[0.06] text-ink' : ''}`}
          >
            <IconGrid size={14} />
            <span className="max-[1000px]:sr-only">Dashboard</span>
          </Button>
        </Tooltip>
        <Tooltip label="Keyboard shortcuts" shortcut="?" align="end">
          <Button variant="ghost" size="sm" onClick={() => openDialog({ kind: 'shortcuts' })} aria-label="Keyboard shortcuts" className="text-muted">
            <IconKeyboard size={14} />
            <span className="max-[1000px]:sr-only">Shortcuts</span>
          </Button>
        </Tooltip>
        <Tooltip label={hasProjects ? 'New agent' : 'Create a project first'} shortcut={hasProjects ? 'N' : undefined} align="end">
          <Button
            variant="primary"
            size="sm"
            onClick={() => openDialog({ kind: 'launch' })}
            disabled={!hasProjects}
            aria-label="New agent"
            className="ml-1 h-8 rounded-full px-3.5"
          >
            <IconPlus size={14} />
            New agent
            {hasProjects && <Kbd>N</Kbd>}
          </Button>
        </Tooltip>
      </div>
    </header>
  )
}

/** Orbit's own mark: a planet on an orbit. Drawn here, not taken from anyone else. */
function OrbitMark() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true" className="shrink-0">
      <defs>
        <radialGradient id="orbit-planet" cx="35%" cy="35%" r="65%">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#71717a" />
        </radialGradient>
      </defs>
      <ellipse cx="11" cy="11" rx="10" ry="4.2" fill="none" stroke="rgba(244,244,245,0.3)" strokeWidth="1" transform="rotate(-18 11 11)" />
      <circle cx="11" cy="11" r="4.6" fill="url(#orbit-planet)" />
      <circle cx="17.4" cy="7.2" r="1.6" style={{ fill: 'var(--color-claude)' }} />
    </svg>
  )
}
