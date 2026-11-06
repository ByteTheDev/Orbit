import { useLayoutEffect, useRef, useState, type ReactNode, type UIEvent } from 'react'

interface Props<T> {
  items: T[]
  rowHeight: number
  renderRow: (item: T, index: number) => ReactNode
  /** Rows to render beyond the visible window, on each side. */
  overscan?: number
  empty?: ReactNode
  className?: string
  /** Keep the view pinned to the newest item while the user is at the bottom. */
  stickToEnd?: boolean
}

/**
 * Fixed-row-height virtual list. Only the rows in view (plus a small overscan)
 * are rendered, so a log with thousands of lines costs the same as one with twenty.
 */
export function VirtualList<T>({ items, rowHeight, renderRow, overscan = 8, empty, className = '', stickToEnd = false }: Props<T>) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [height, setHeight] = useState(0)
  const atEnd = useRef(true)

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const measure = () => setHeight(el.clientHeight)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el || !stickToEnd) return
    if (atEnd.current) el.scrollTop = el.scrollHeight
  }, [items.length, stickToEnd])

  if (items.length === 0 && empty) {
    return <div className={`flex min-h-0 flex-1 items-center justify-center ${className}`}>{empty}</div>
  }

  const total = items.length * rowHeight
  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan)
  const end = Math.min(items.length, Math.ceil((scrollTop + height) / rowHeight) + overscan)

  const onScroll = (e: UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    setScrollTop(el.scrollTop)
    atEnd.current = el.scrollHeight - el.scrollTop - el.clientHeight < rowHeight * 2
  }

  const rows: ReactNode[] = []
  for (let i = start; i < end; i++) {
    rows.push(
      <div key={i} style={{ position: 'absolute', top: i * rowHeight, left: 0, right: 0, height: rowHeight }}>
        {renderRow(items[i], i)}
      </div>,
    )
  }

  return (
    <div ref={scrollRef} onScroll={onScroll} className={`relative min-h-0 flex-1 overflow-y-auto ${className}`}>
      <div style={{ height: total, position: 'relative' }}>{rows}</div>
    </div>
  )
}
