import type { ReactNode } from 'react'
import { Kbd } from '../ui'

interface Props {
  label: string
  shortcut?: string
  /** Which edge of the trigger the tooltip hangs from. */
  align?: 'center' | 'start' | 'end'
  children: ReactNode
}

/**
 * A quiet tooltip that appears after a short hover, or straight away on keyboard focus.
 * The trigger carries the accessible name, so the tooltip itself is hidden from assistive tech.
 */
export function Tooltip({ label, shortcut, align = 'center', children }: Props) {
  const place = align === 'start' ? 'left-0' : align === 'end' ? 'right-0' : 'left-1/2 -translate-x-1/2'
  return (
    <span className="group/tip relative inline-flex">
      {children}
      <span
        aria-hidden="true"
        className={`pointer-events-none absolute top-full z-50 mt-1.5 flex items-center gap-2 whitespace-nowrap rounded-md border border-tint/[0.08] glass-tip px-2 py-1 text-label text-ink opacity-0 shadow-float transition-opacity duration-150 group-hover/tip:delay-[350ms] group-hover/tip:opacity-100 group-has-[:focus-visible]/tip:opacity-100 motion-reduce:transition-none ${place}`}
      >
        {label}
        {shortcut && <Kbd>{shortcut}</Kbd>}
      </span>
    </span>
  )
}
