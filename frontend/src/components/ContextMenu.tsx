import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export interface MenuItem {
  label: string
  onSelect: () => void
  disabled?: boolean
  danger?: boolean
  hint?: string
  icon?: ReactNode
  /** The item is the view the user is on. Shown with a faint fill and aria-current. */
  active?: boolean
}

interface Props {
  x: number
  y: number
  items: MenuItem[]
  onClose: () => void
  label: string
  /** 'start' opens to the right of x (the default); 'end' opens to its left, so the menu's right edge sits at x. */
  align?: 'start' | 'end'
}

/**
 * Right-click menu. Clamped to the window, closed by Escape, outside click, scroll or resize.
 * It renders in document.body: a position:fixed element inside a backdrop-filter panel (the glass sidebar)
 * is positioned against that panel, which puts the menu out of line with the click.
 */
export function ContextMenu({ x, y, items, onClose, label, align = 'start' }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x, top: y })

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    const wanted = align === 'end' ? x - width : x
    setPos({
      // Stay inside the window on every side, even when the window is narrower than the menu.
      left: Math.max(8, Math.min(wanted, window.innerWidth - width - 8)),
      top: Math.max(8, Math.min(y, window.innerHeight - height - 8)),
    })
  }, [x, y, align])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
        return
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const buttons = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])
        if (buttons.length === 0) return
        const idx = buttons.indexOf(document.activeElement as HTMLButtonElement)
        const next = buttons[(idx + (e.key === 'ArrowDown' ? 1 : buttons.length - 1) + buttons.length) % buttons.length]
        next.focus()
        e.preventDefault()
      }
    }
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('resize', onClose)
    window.addEventListener('wheel', onClose, { passive: true })
    ref.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('resize', onClose)
      window.removeEventListener('wheel', onClose)
    }
  }, [onClose])

  return createPortal(
    <div
      ref={ref}
      role="menu"
      aria-label={label}
      className="fixed z-40 min-w-[196px] origin-top-left animate-menu-in rounded-lg border border-tint/[0.08] glass-popover p-1 shadow-popover motion-reduce:animate-none"
      style={{ left: pos.left, top: pos.top }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item) => (
        <button
          key={item.label}
          role="menuitem"
          disabled={item.disabled}
          onClick={() => {
            onClose()
            item.onSelect()
          }}
          aria-current={item.active ? 'true' : undefined}
          className={`flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-body transition-colors duration-100 hover:bg-tint/[0.06] focus:bg-tint/[0.06] focus:outline-none disabled:opacity-40 ${
            item.danger ? 'text-danger-soft hover:bg-danger/10 focus:bg-danger/10' : 'text-ink'
          } ${item.active ? 'bg-tint/[0.05]' : ''}`}
        >
          {item.icon && <span className={`flex shrink-0 ${item.danger ? 'text-danger' : 'text-faint'}`}>{item.icon}</span>}
          <span className="flex-1">{item.label}</span>
          {item.hint && <span className="font-mono text-label text-faint">{item.hint}</span>}
        </button>
      ))}
    </div>,
    document.body,
  )
}
