import { useEffect, useState } from 'react'
import { refreshLimits } from '../lib/actions'
import { useStore } from '../lib/store'
import { percentLeft, resetLabel, USAGE_PROVIDERS } from '../lib/usage'
import type { ProviderLimits } from '../types'
import { IconRetry } from './inspector/inspectorIcons'
import { ProviderMark } from './ui'

/**
 * How often the open window re-reads the limits. It matches the backend cache (limitsTTL), so each
 * poll either gets a fresh reading or the cached one it would have had anyway.
 */
const LIMITS_POLL_MS = 3 * 60 * 1000

/** Each provider's name with how much of its 5-hour and weekly allowance is left. Always visible. */
export function UsageBar() {
  const limits = useStore((s) => s.limits)
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => {
    void refreshLimits(false)
    const timer = setInterval(() => void refreshLimits(false), LIMITS_POLL_MS)
    return () => clearInterval(timer)
  }, [])

  // Asks the CLIs now, bypassing the backend cache. refreshLimits reports failures as toasts itself.
  const refresh = async () => {
    setRefreshing(true)
    try {
      await refreshLimits(true)
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <footer aria-label="Provider usage" className="flex h-7 shrink-0 items-center gap-5 overflow-x-auto border-t border-line glass-sidebar px-3 text-label text-muted">
      {USAGE_PROVIDERS.map((p) => (
        <span key={p.id} className="flex shrink-0 items-center gap-1.5 tabular-nums">
          <ProviderMark provider={p.id} size={14} />
          <span className="font-medium text-ink">{p.label}</span>
          <LimitsSummary limits={limits.find((l) => l.provider === p.id)} />
        </span>
      ))}
      <button
        type="button"
        onClick={() => void refresh()}
        disabled={refreshing}
        aria-label="Refresh usage"
        title="Refresh usage now (also refreshes every 3 minutes)"
        className="ml-auto flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-faint transition-colors duration-150 hover:bg-row-hover hover:text-ink disabled:opacity-60"
      >
        <IconRetry size={11} className={refreshing ? 'animate-spin motion-reduce:animate-none' : undefined} />
      </button>
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
