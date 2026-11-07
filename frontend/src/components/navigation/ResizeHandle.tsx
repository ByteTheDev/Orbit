import { useRef, type KeyboardEvent, type PointerEvent } from 'react'
import { SIDEBAR_DEFAULT, SIDEBAR_MAX, SIDEBAR_MIN, clampSidebarWidth } from '../../lib/sidebarPrefs'

interface Props {
  width: number
  /** Called on every pointer move with the clamped width. Should only touch the DOM. */
  onPreview: (width: number) => void
  /** Called once the drag ends, or for a key press, with the final width. Persists it. */
  onCommit: (width: number) => void
}

/**
 * The sidebar's right edge. Drag to resize; arrow keys nudge by 16px; double-click resets.
 * During a drag the width is previewed without touching the store, so the rest of the app
 * does not re-render on every pointer move.
 */
export function ResizeHandle({ width, onPreview, onCommit }: Props) {
  const drag = useRef<{ startX: number; startWidth: number; last: number } | null>(null)

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { startX: e.clientX, startWidth: width, last: width }
  }

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d) return
    d.last = clampSidebarWidth(d.startWidth + (e.clientX - d.startX))
    onPreview(d.last)
  }

  const finish = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d) return
    drag.current = null
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    if (d.last !== width) onCommit(d.last)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault()
      onCommit(clampSidebarWidth(width + (e.key === 'ArrowRight' ? 16 : -16)))
    } else if (e.key === 'Home') {
      e.preventDefault()
      onCommit(SIDEBAR_MIN)
    } else if (e.key === 'End') {
      e.preventDefault()
      onCommit(SIDEBAR_MAX)
    }
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sidebar"
      aria-valuemin={SIDEBAR_MIN}
      aria-valuemax={SIDEBAR_MAX}
      aria-valuenow={width}
      tabIndex={0}
      title="Drag to resize. Double-click to reset."
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finish}
      onPointerCancel={finish}
      onDoubleClick={() => onCommit(SIDEBAR_DEFAULT)}
      onKeyDown={onKeyDown}
      className="group/resize absolute inset-y-0 -right-1.5 z-10 flex w-3 cursor-col-resize touch-none justify-center outline-none"
    >
      <span className="h-full w-px bg-line transition-colors duration-150 group-hover/resize:bg-white/40 group-focus-visible/resize:bg-white/50 group-active/resize:bg-white/60" />
    </div>
  )
}
