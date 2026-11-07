import { useEffect, useRef, useState } from 'react'
import { useStore, openDialog, setState } from '../lib/store'
import { Button, IconClock, IconGlobe, IconGrid, IconMenu, IconPlus, IconSidebar, IconSliders, Kbd, Tag } from './ui'
import { Tooltip } from './navigation/Tooltip'
import { ContextMenu, type MenuItem } from './ContextMenu'
import { IS_DEV_BUILD } from '../lib/buildChannel'

/** Top bar: brand, a live summary, New agent, and one menu for the secondary views. */
export function TopBar() {
  const agents = useStore((s) => s.agentOrder.length)
  const running = useStore((s) => Object.values(s.agents).filter((a) => a.running).length)
  const conflicts = useStore((s) => Object.values(s.projects).reduce((n, p) => n + p.conflicts.length, 0))
  const projectsOpen = useStore((s) => s.projectsOpen)
  const hasProjects = useStore((s) => s.projectOrder.length > 0)
  const loading = useStore((s) => s.loading)

  const summary = loading && !hasProjects
    ? 'Loading…'
    : agents === 0
      ? 'No agents running'
      : `${agents} agent${agents === 1 ? '' : 's'} · ${running} running${conflicts ? ` · ${conflicts} conflicting file${conflicts === 1 ? '' : 's'}` : ''}`
  const live = running > 0

  return (
    // Three columns: the two sides take equal space, so the summary sits at the true centre of the bar.
    <header className="grid h-14 shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 border-b border-line glass-sidebar px-4">
      <div className="flex min-w-0 items-center gap-3 justify-self-start">
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
          <span className="text-title font-semibold tracking-[-0.01em] text-ink max-[760px]:sr-only">Orbit</span>
          {IS_DEV_BUILD && (
            <span title="Development build. Official releases do not show this tag." data-build-channel="dev">
              <Tag tone="warn">Dev</Tag>
            </span>
          )}
        </div>
      </div>

      <div className="flex min-w-0 max-w-full justify-center" aria-live="polite">
        <div className="inline-flex max-w-full items-center gap-2 rounded-full bg-surface px-3 py-1 text-caption tabular-nums text-muted">
          <span className="relative flex h-1.5 w-1.5 shrink-0">
            {live && <span className="absolute inset-0 animate-ping rounded-full bg-status-thinking/60 motion-reduce:animate-none" />}
            <span className="relative h-1.5 w-1.5 rounded-full" style={{ background: live ? 'var(--color-status-thinking)' : 'var(--color-faint)' }} />
          </span>
          <span className="truncate">{summary}</span>
        </div>
      </div>

      <div className="flex min-w-0 items-center gap-2 justify-self-end">
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
        <NavMenu />
      </div>
    </header>
  )
}

/**
 * The secondary views (Dashboard, Browser, Settings) behind one menu. Opens under the trigger, aligned to its
 * right edge. Clicking the trigger again closes it. The view the user is on is marked in the list.
 */
function NavMenu() {
  const dashboardOpen = useStore((s) => s.dashboardOpen)
  const dialog = useStore((s) => s.dialog)
  const [open, setOpen] = useState(false)
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  // The menu closes on the press that opens nothing, before the click arrives. Remember whether it was open then.
  const pressedWhileOpen = useRef(false)
  const wasOpen = useRef(false)

  // When the menu closes by Escape or a choice, focus goes with it. Return it to the trigger.
  // A click elsewhere leaves focus where the user put it, so it is not moved.
  useEffect(() => {
    if (open) {
      wasOpen.current = true
      return
    }
    if (wasOpen.current) {
      wasOpen.current = false
      const active = document.activeElement
      if (!active || active === document.body) triggerRef.current?.focus()
    }
  }, [open])

  const items: MenuItem[] = [
    {
      label: 'Dashboard',
      icon: <IconGrid size={13} />,
      hint: 'D',
      active: dashboardOpen,
      onSelect: () => setState((s) => ({ dashboardOpen: !s.dashboardOpen })),
    },
    {
      label: 'Browser',
      icon: <IconGlobe size={13} />,
      hint: 'B',
      active: dialog?.kind === 'browser',
      onSelect: () => openDialog({ kind: 'browser' }),
    },
    {
      label: 'Automations',
      icon: <IconClock size={13} />,
      active: dialog?.kind === 'automations',
      onSelect: () => openDialog({ kind: 'automations' }),
    },
    {
      label: 'Settings',
      icon: <IconSliders size={13} />,
      hint: ',',
      active: dialog?.kind === 'settings',
      onSelect: () => openDialog({ kind: 'settings' }),
    },
  ]

  return (
    <>
      <Tooltip label="Menu" align="end">
        <Button
          ref={triggerRef}
          variant="ghost"
          size="sm"
          aria-label="Menu"
          aria-haspopup="menu"
          aria-expanded={open}
          onPointerDown={() => {
            pressedWhileOpen.current = open
          }}
          onClick={(e) => {
            // A mouse press on an open menu has already closed it (outside-press), so this click is a close, not a reopen.
            const pressedOpen = e.detail > 0 && pressedWhileOpen.current
            pressedWhileOpen.current = false
            if (open || pressedOpen) {
              setOpen(false)
              return
            }
            const r = e.currentTarget.getBoundingClientRect()
            setAnchor({ x: r.right, y: r.bottom + 8 })
            setOpen(true)
          }}
          className={`h-8 w-8 px-0 text-muted ${open ? 'bg-row-active text-ink' : ''}`}
        >
          <IconMenu size={16} />
        </Button>
      </Tooltip>
      {open && anchor && (
        <ContextMenu x={anchor.x} y={anchor.y} align="end" label="Main menu" items={items} onClose={() => setOpen(false)} />
      )}
    </>
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
      <ellipse cx="11" cy="11" rx="10" ry="4.2" fill="none" strokeWidth="1" transform="rotate(-18 11 11)" style={{ stroke: 'var(--color-ink)', strokeOpacity: 0.3 }} />
      <circle cx="11" cy="11" r="4.6" fill="url(#orbit-planet)" />
      <circle cx="17.4" cy="7.2" r="1.6" style={{ fill: 'var(--color-claude)' }} />
    </svg>
  )
}
