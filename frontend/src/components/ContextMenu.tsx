import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

export interface MenuItem {
  label: string
  onSelect: () => void
  disabled?: boolean
  danger?: boolean
  hint?: string
  icon?: ReactNode
}

interface Props {
  x: number
  y: number
  items: MenuItem[]
  onClose: () => void
  label: string
}

/** Right-click menu. Clamped to the window, closed by Escape, outside click, scroll or resize. */
export function ContextMenu({ x, y, items, onClose, label }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x, top: y })

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    setPos({
      left: Math.min(x, window.innerWidth - width - 8),
      top: Math.min(y, window.innerHeight - height - 8),
    })
  }, [x, y])

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

  return (
    <div
      ref={ref}
      role="menu"
      aria-label={label}
      className="fixed z-40 min-w-[196px] animate-[fade-in_120ms_ease-out] rounded-lg border border-white/[0.08] bg-popover/95 p-1 shadow-popover backdrop-blur-md motion-reduce:animate-none"
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
          className={`flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors duration-100 hover:bg-white/[0.06] focus:bg-white/[0.06] focus:outline-none disabled:opacity-40 ${
            item.danger ? 'text-danger-soft hover:bg-danger/10 focus:bg-danger/10' : 'text-ink'
          }`}
        >
          {item.icon && <span className={`flex shrink-0 ${item.danger ? 'text-danger' : 'text-faint'}`}>{item.icon}</span>}
          <span className="flex-1">{item.label}</span>
          {item.hint && <span className="font-mono text-[11px] text-faint">{item.hint}</span>}
        </button>
      ))}
    </div>
  )
}
