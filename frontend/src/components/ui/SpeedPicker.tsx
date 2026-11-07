import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { IconChevronDown } from './icons'
import { compactTrigger } from './index'

/**
 * One speed the next message can run at. Rank sets how it looks on the trigger: 0 is plain,
 * 1 is white streaks running right (Fast), 2 is fiery streaks that run faster (Ultrafast).
 */
export interface SpeedOption {
  id: string
  label: string
  description: string
  rank: 0 | 1 | 2
}

/** The speeds every agent offers. Each one maps onto the agent's fast and ultrafast settings. */
export const SPEED_OPTIONS: SpeedOption[] = [
  { id: 'standard', label: 'Standard', description: 'Default speed.', rank: 0 },
  { id: 'fast', label: 'Fast', description: 'Faster output from this model.', rank: 1 },
]

/** Offered only where the signed-in account can run its model in ultrafast mode. */
const ULTRAFAST_OPTION: SpeedOption = { id: 'ultrafast', label: 'Ultrafast', description: 'The fastest output this account offers.', rank: 2 }

/** The speeds to offer for a model: Ultrafast is added only when the account can run it that way. */
export function speedOptionsFor(ultraOffered: boolean): SpeedOption[] {
  return ultraOffered ? [...SPEED_OPTIONS, ULTRAFAST_OPTION] : SPEED_OPTIONS
}

/** The speed id an agent is on, from its fast and ultrafast settings. */
export function speedOf(fast: boolean, ultra: boolean): string {
  return ultra ? 'ultrafast' : fast ? 'fast' : 'standard'
}

/**
 * TEMPORARY preview: forces every speed trigger to show this rank's effect (1 = Fast streaks,
 * 2 = Ultrafast). Set to null to go back to showing each agent's real speed.
 */
const PREVIEW_RANK: 0 | 1 | 2 | null = null

// Streaks are placed by hand so they sit on different lines and never run in step.
// dur is the Fast run time in seconds; Ultrafast runs the same streaks in less than half that.
const STREAKS = [
  { top: '22%', width: '34%', delay: '0s', dur: 0.9 },
  { top: '46%', width: '52%', delay: '-0.35s', dur: 0.75 },
  { top: '70%', width: '28%', delay: '-0.6s', dur: 1 },
  { top: '34%', width: '20%', delay: '-0.5s', dur: 1.1 },
  { top: '58%', width: '42%', delay: '-0.15s', dur: 0.8 },
]

/**
 * Speed chooser: one dropdown in place of separate on/off switches. The list always opens upward,
 * because it sits at the bottom of the chat and the launch dialog. Arrow keys move, Enter picks,
 * Escape closes, and an outside click closes it.
 */
export function SpeedPicker({
  value,
  options,
  onChange,
  disabled,
  title,
  'aria-label': ariaLabel,
}: {
  value: string
  options: SpeedOption[]
  onChange: (id: string) => void
  disabled?: boolean
  title?: string
  'aria-label'?: string
}) {
  const triggerRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [pos, setPos] = useState<{ left: number; width: number; bottom: number } | null>(null)

  const selected = options.find((o) => o.id === value) ?? options[0]
  const rank = PREVIEW_RANK ?? selected?.rank ?? 0

  const openList = () => {
    if (disabled || options.length === 0) return
    const start = Math.max(0, options.findIndex((o) => o.id === value))
    setActive(start)
    setPos(null)
    setOpen(true)
  }

  const close = () => {
    setOpen(false)
    triggerRef.current?.focus()
  }

  const commit = (i: number) => {
    const option = options[i]
    if (!option) return
    onChange(option.id)
    close()
  }

  // Sit above the trigger, aligned to its left edge and kept inside the window.
  useLayoutEffect(() => {
    if (!open) return
    const trigger = triggerRef.current
    if (!trigger) return
    const r = trigger.getBoundingClientRect()
    const margin = 8
    const width = Math.min(Math.max(r.width, 240), window.innerWidth - margin * 2)
    const left = Math.max(margin, Math.min(r.left, window.innerWidth - margin - width))
    setPos({ left, width, bottom: window.innerHeight - r.top + 4 })
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.focus()
    // Only on open: the list is placed once per opening, not on every arrow key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node
      if (triggerRef.current?.contains(t) || listRef.current?.contains(t)) return
      setOpen(false)
    }
    const onScroll = (e: Event) => {
      if (listRef.current?.contains(e.target as Node)) return
      setOpen(false)
    }
    const onResize = () => setOpen(false)
    document.addEventListener('pointerdown', onDown, true)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onResize)
    return () => {
      document.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onResize)
    }
  }, [open])

  const onListKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const n = options.length
    const focusRow = (i: number) => {
      setActive(i)
      listRef.current?.querySelector<HTMLElement>(`[data-index="${i}"]`)?.focus()
    }
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        focusRow((active + 1) % n)
        break
      case 'ArrowUp':
        e.preventDefault()
        focusRow((active - 1 + n) % n)
        break
      case 'Enter':
      case ' ':
        e.preventDefault()
        commit(active)
        break
      case 'Escape':
        e.preventDefault()
        e.stopPropagation()
        close()
        break
      case 'Tab':
        setOpen(false)
        break
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        title={title}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={(e) => {
          if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
            e.preventDefault()
            openList()
          }
        }}
        className={`${compactTrigger} relative max-w-full overflow-hidden ${rank > 1 ? 'speed-fire-ultra text-amber-100' : rank === 1 ? 'speed-fire text-white' : ''}`}
      >
        {rank > 0 && (
          // Keyed on the speed, so switching up replays the ring and the streaks start again.
          <span key={selected?.id} aria-hidden="true" className="pointer-events-none absolute inset-0">
            <span className="speed-ring" />
            {STREAKS.slice(0, rank > 1 ? STREAKS.length : 3).map((s, i) => (
              <span
                key={i}
                className={rank > 1 ? 'speed-streak speed-streak-ultra' : 'speed-streak'}
                style={{ top: s.top, width: s.width, animationDelay: s.delay, animationDuration: `${rank > 1 ? s.dur * 0.4 : s.dur}s` }}
              />
            ))}
          </span>
        )}
        <span className="relative z-10 flex min-w-0 items-center gap-1.5">
          <span className="truncate">{selected?.label ?? ''}</span>
          <IconChevronDown size={12} className={`shrink-0 transition-transform duration-150 motion-reduce:transition-none ${open ? 'rotate-180' : ''}`} />
        </span>
      </button>
      {open &&
        createPortal(
          <div
            ref={listRef}
            role="listbox"
            aria-label={ariaLabel}
            data-listbox-open=""
            onKeyDown={onListKey}
            style={pos ? { left: pos.left, width: pos.width, bottom: pos.bottom } : { left: 0, top: 0, visibility: 'hidden' }}
            className="fixed z-[60] flex flex-col overflow-hidden rounded-xl border border-tint/[0.08] glass-popover p-1 shadow-popover animate-fade-in"
          >
            {options.map((o, i) => {
              const isSelected = o.id === value
              return (
                <button
                  key={o.id}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  data-index={i}
                  tabIndex={i === active ? 0 : -1}
                  onClick={() => commit(i)}
                  onMouseEnter={() => setActive(i)}
                  className={`flex w-full min-w-0 flex-col items-start rounded-lg px-2.5 py-2 text-left outline-none transition-colors duration-100 focus-visible:bg-row-hover ${
                    isSelected ? 'text-ink' : 'text-muted hover:text-ink'
                  } hover:bg-row-hover`}
                >
                  <span className="text-caption font-medium">{o.label}</span>
                  <span className="text-label text-faint">{o.description}</span>
                </button>
              )
            })}
          </div>,
          document.body,
        )}
    </>
  )
}
