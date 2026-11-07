import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { api, errorText, onTerminalEvents } from '../../lib/bridge'
import { toast, useStore } from '../../lib/store'
import { Button, IconPlus, IconX, Kbd } from '../ui'

/**
 * A shell panel along the bottom of the universe. Each terminal runs in its project's
 * repository folder. Terminals keep running while the panel is hidden or the project changes.
 *
 * The panel stays mounted when hidden. xterm attaches to the DOM once, so unmounting the
 * panel would leave a blank terminal when it reopened.
 */

interface Tab {
  id: string
  projectId: string
  title: string
  ended: boolean
}

interface Instance {
  term: Terminal
  fit: FitAddon
  opened: boolean
}

const DEFAULT_HEIGHT = 300
const MIN_HEIGHT = 120
const CLOSED_HEIGHT = 32
const HEIGHT_KEY = 'orbit:terminal-height'
const TOGGLE_EVENT = 'orbit:toggle-terminal'

/** The panel may take up to 70% of the window, so the galaxy always keeps room. */
function clampHeight(h: number): number {
  const max = typeof window === 'undefined' ? 900 : Math.max(MIN_HEIGHT, Math.round(window.innerHeight * 0.7))
  return Math.min(max, Math.max(MIN_HEIGHT, Math.round(h)))
}

function savedHeight(): number {
  try {
    const raw = Number(localStorage.getItem(HEIGHT_KEY))
    return Number.isFinite(raw) && raw > 0 ? clampHeight(raw) : DEFAULT_HEIGHT
  } catch {
    return DEFAULT_HEIGHT
  }
}

const DARK_TERMINAL = {
  background: '#0d0d0f',
  foreground: '#e4e4e7',
  cursor: '#f4f4f5',
  cursorAccent: '#0d0d0f',
  selectionBackground: 'rgb(244 244 245 / 0.16)',
}

const LIGHT_TERMINAL = {
  background: '#ffffff',
  foreground: '#27272a',
  cursor: '#18181b',
  cursorAccent: '#ffffff',
  selectionBackground: 'rgb(24 24 27 / 0.14)',
}

function newTerminal(): Terminal {
  // The tint is black on light themes (lib/settings.ts), so it tells us which palette to draw.
  const light = typeof document !== 'undefined' && getComputedStyle(document.documentElement).getPropertyValue('--color-tint').trim() === '#000000'
  return new Terminal({
    cursorBlink: true,
    fontFamily: '"Cascadia Code", "Cascadia Mono", Consolas, monospace',
    fontSize: 12,
    lineHeight: 1.2,
    scrollback: 5000,
    theme: light ? LIGHT_TERMINAL : DARK_TERMINAL,
  })
}

export function TerminalPanel() {
  const activeProjectId = useStore((s) => s.activeProjectId)
  const projects = useStore((s) => s.projects)
  const [open, setOpen] = useState(false)
  const [height, setHeight] = useState(savedHeight)
  const [tabs, setTabs] = useState<Tab[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const instances = useRef(new Map<string, Instance>())
  const bodyRef = useRef<HTMLDivElement>(null)

  const project = activeProjectId ? projects[activeProjectId] : undefined
  const visible = useMemo(() => tabs.filter((t) => t.projectId === activeProjectId), [tabs, activeProjectId])
  const current = visible.find((t) => t.id === activeId) ?? visible[0]

  // Output and exit events from the backend, routed to the terminal they belong to.
  useEffect(() => {
    return onTerminalEvents({
      output: (id, data) => instances.current.get(id)?.term.write(data),
      exit: (id) => {
        instances.current.get(id)?.term.write('\r\n\x1b[90m[process ended]\x1b[0m\r\n')
        setTabs((prev) => prev.map((t) => (t.id === id ? { ...t, ended: true } : t)))
      },
    })
  }, [])

  // Ctrl+` opens and closes the panel. Captured first, so the shell never receives the keystroke.
  useEffect(() => {
    const toggle = () => setOpen((v) => !v)
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && !e.altKey && !e.metaKey && e.key === '`') {
        e.preventDefault()
        e.stopPropagation()
        toggle()
      }
    }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener(TOGGLE_EVENT, toggle)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener(TOGGLE_EVENT, toggle)
    }
  }, [])

  // Shells end with the app; this also ends them if the panel ever unmounts.
  useEffect(() => {
    const all = instances.current
    return () => {
      all.forEach((inst, id) => {
        void api.closeTerminal(id).catch(() => {})
        inst.term.dispose()
      })
      all.clear()
    }
  }, [])

  // Fit the visible terminal when it appears or changes, and whenever the panel resizes.
  useEffect(() => {
    if (!open || !current) return
    const inst = instances.current.get(current.id)
    if (!inst) return
    const frame = requestAnimationFrame(() => {
      inst.fit.fit()
      inst.term.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [open, current?.id])

  useEffect(() => {
    const el = bodyRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      if (open && current) instances.current.get(current.id)?.fit.fit()
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [open, current?.id])

  // Open the first terminal of a project automatically, so the panel is never an empty box.
  useEffect(() => {
    if (open && activeProjectId && !tabs.some((t) => t.projectId === activeProjectId)) {
      void createTerminal()
    }
    // Runs when the panel opens or the project changes. It must not re-run on every tab change.
  }, [open, activeProjectId])

  // Attaches xterm to its host element the first time the element exists.
  const attach = (id: string) => (el: HTMLDivElement | null) => {
    const inst = instances.current.get(id)
    if (el && inst && !inst.opened) {
      inst.term.open(el)
      inst.opened = true
    }
  }

  async function createTerminal() {
    if (!activeProjectId) return
    const id = crypto.randomUUID()
    const term = newTerminal()
    const fit = new FitAddon()
    term.loadAddon(fit)
    instances.current.set(id, { term, fit, opened: false })
    term.onData((data) => void api.writeTerminal(id, data).catch(() => {}))
    term.onResize(({ cols, rows }) => void api.resizeTerminal(id, cols, rows).catch(() => {}))

    const number = tabs.filter((t) => t.projectId === activeProjectId).length + 1
    setTabs((prev) => [...prev, { id, projectId: activeProjectId, title: `Terminal ${number}`, ended: false }])
    setActiveId(id)
    try {
      await api.openTerminal(id, activeProjectId, term.cols, term.rows)
    } catch (err) {
      const message = errorText(err)
      term.write(`\r\n\x1b[31m${message}\x1b[0m\r\n`)
      setTabs((prev) => prev.map((t) => (t.id === id ? { ...t, ended: true } : t)))
      toast(message, 'error')
    }
  }

  function closeTab(id: string) {
    void api.closeTerminal(id).catch(() => {})
    instances.current.get(id)?.term.dispose()
    instances.current.delete(id)
    setTabs((prev) => prev.filter((t) => t.id !== id))
    if (activeId === id) setActiveId(null)
  }

  const toggle = () => setOpen((v) => !v)

  // Remember the height the user chose. Written after the drag ends, not on every pointer move.
  const commitHeight = (h: number) => {
    setHeight(h)
    try {
      localStorage.setItem(HEIGHT_KEY, String(h))
    } catch {
      /* storage can be unavailable; the height still applies for this session */
    }
  }

  // Dragging the top edge: the panel grows as the pointer moves up, shrinks as it moves down.
  const dragStart = useRef<{ y: number; h: number } | null>(null)
  const onResizeDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    dragStart.current = { y: e.clientY, h: height }
  }
  const onResizeMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const start = dragStart.current
    if (!start) return
    setHeight(clampHeight(start.h + (start.y - e.clientY)))
  }
  const onResizeUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragStart.current) return
    dragStart.current = null
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    commitHeight(clampHeight(height))
  }
  // Keyboard: arrows step the height, Home restores the default. Double-click does the same.
  const onResizeKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = e.key === 'ArrowUp' ? 24 : e.key === 'ArrowDown' ? -24 : 0
    if (step) {
      e.preventDefault()
      commitHeight(clampHeight(height + step))
    } else if (e.key === 'Home') {
      e.preventDefault()
      commitHeight(DEFAULT_HEIGHT)
    }
  }

  return (
    <section
      aria-label="Terminal"
      className="relative flex shrink-0 flex-col border-t border-line glass-main"
      style={{ height: open ? clampHeight(height) : CLOSED_HEIGHT }}
    >
      {open && (
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize terminal. Arrow keys change the height, Home restores the default."
          aria-valuemin={MIN_HEIGHT}
          aria-valuenow={clampHeight(height)}
          tabIndex={0}
          title="Drag to resize. Double-click to reset."
          onPointerDown={onResizeDown}
          onPointerMove={onResizeMove}
          onPointerUp={onResizeUp}
          onPointerCancel={onResizeUp}
          onDoubleClick={() => commitHeight(DEFAULT_HEIGHT)}
          onKeyDown={onResizeKey}
          className="group absolute inset-x-0 -top-1 z-10 flex h-2 cursor-row-resize touch-none items-center justify-center outline-none"
        >
          <span className="h-0.5 w-10 rounded-full bg-tint/0 transition-colors duration-150 group-hover:bg-tint/25 group-focus-visible:bg-tint/40 group-active:bg-tint/50" />
        </div>
      )}
      {open ? (
        <div className="flex h-9 shrink-0 items-center gap-1 border-b border-line px-2">
          <div role="tablist" aria-label="Terminals" className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
            {visible.map((t) => (
              <div
                key={t.id}
                className={`flex h-7 shrink-0 items-center gap-1 rounded-md pl-2.5 pr-1 text-caption ${
                  t.id === current?.id ? 'bg-tint/[0.07] text-ink' : 'text-muted hover:bg-tint/[0.04] hover:text-ink'
                }`}
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={t.id === current?.id}
                  onClick={() => setActiveId(t.id)}
                  className="flex items-center gap-1.5 py-1"
                >
                  {t.title}
                  {t.ended && <span className="text-label uppercase tracking-[0.06em] text-faint">ended</span>}
                </button>
                <button
                  type="button"
                  aria-label={`Close ${t.title}`}
                  onClick={() => closeTab(t.id)}
                  className="flex h-5 w-5 items-center justify-center rounded text-faint hover:bg-tint/10 hover:text-ink"
                >
                  <IconX size={10} />
                </button>
              </div>
            ))}
          </div>
          <span className="hidden max-w-[40%] truncate px-2 font-mono text-label text-faint sm:block" title={project?.repoPath}>
            {project ? project.repoPath : 'No project selected'}
          </span>
          <Button
            variant="ghost"
            size="sm"
            aria-label="New terminal"
            title="New terminal"
            onClick={() => void createTerminal()}
            disabled={!activeProjectId}
            className="h-7 w-7 shrink-0 rounded-md px-0"
          >
            <IconPlus size={12} />
          </Button>
          <Button variant="ghost" size="sm" aria-label="Hide terminal" title="Hide (Ctrl+`)" onClick={toggle} className="h-7 w-7 shrink-0 rounded-md px-0">
            <IconX size={12} />
          </Button>
        </div>
      ) : (
        <div className="flex h-8 shrink-0 items-center px-3">
          <button
            type="button"
            onClick={toggle}
            aria-label="Open terminal"
            className="flex items-center gap-2 rounded-md px-2 py-1 text-caption text-muted hover:bg-tint/[0.05] hover:text-ink"
          >
            Terminal
            <Kbd>Ctrl</Kbd>
            <Kbd>`</Kbd>
          </button>
        </div>
      )}

      <div ref={bodyRef} className={`relative min-h-0 flex-1 px-2 pb-2 pt-1 ${open ? '' : 'hidden'}`}>
        {!activeProjectId && <Empty text="Choose a project to open a terminal in its folder." />}
        {activeProjectId && visible.length === 0 && <Empty text="No terminals for this project. Press + to open one." />}
        {tabs.map((t) => {
          const shown = open && t.id === current?.id && t.projectId === activeProjectId
          return <div key={t.id} ref={attach(t.id)} className={`absolute inset-x-2 bottom-2 top-1 ${shown ? '' : 'hidden'}`} />
        })}
      </div>
    </section>
  )
}

function Empty({ text }: { text: string }) {
  return <p className="flex h-full items-center justify-center text-center text-caption text-faint">{text}</p>
}
