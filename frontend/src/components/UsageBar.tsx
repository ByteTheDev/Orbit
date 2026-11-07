import { useEffect } from 'react'
import { refreshLimits } from '../lib/actions'
import { useStore } from '../lib/store'
import { percentLeft, resetLabel, USAGE_PROVIDERS } from '../lib/usage'
import type { ProviderLimits } from '../types'
import { ProviderMark } from './ui'

/** How often the open window re-reads the limits. The backend caches for a similar time, so this is cheap. */
const LIMITS_POLL_MS = 3 * 60 * 1000

/** Each provider's name with how much of its 5-hour and weekly allowance is left. Always visible. */
export function UsageBar() {
  const limits = useStore((s) => s.limits)

  useEffect(() => {
    void refreshLimits(false)
    const timer = setInterval(() => void refreshLimits(false), LIMITS_POLL_MS)
    return () => clearInterval(timer)
  }, [])

  return (
    <footer aria-label="Provider usage" className="flex h-7 shrink-0 items-center gap-5 overflow-x-auto border-t border-line bg-sidebar px-3 text-label text-muted">
      {USAGE_PROVIDERS.map((p) => (
        <span key={p.id} className="flex shrink-0 items-center gap-1.5 tabular-nums">
          <ProviderMark provider={p.id} size={14} />
          <span className="font-medium text-ink">{p.label}</span>
          <LimitsSummary limits={limits.find((l) => l.provider === p.id)} />
        </span>
      ))}
    </footer>
  )
}

/** "5-hour 70% left · Weekly 85% left", or a short note when the CLI could not report them. */
function LimitsSummary({ limits }: { limits: ProviderLimits | undefined }) {
  if (!limits) return <span className="text-faint">· limits…</span>
  if (limits.error) return <span className="text-faint" title={limits.error}>· limits unavailable</span>
  return (
    <>
      {limits.windows.map((w) => {
        const reset = resetLabel(w.resetsAt)
        return (
          <span key={w.label} className="flex shrink-0 items-center gap-1.5" title={reset ? `${w.label} window resets ${reset}` : `${w.label} window`}>
            <span className="text-faint">·</span>
            <span>
              {w.label} <span className="font-medium text-ink">{percentLeft(w.usedPercent)}% left</span>
            </span>
          </span>
        )
      })}
    </>
  )
}
