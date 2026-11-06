import { dismissToast, useStore } from '../lib/store'
import { floatingSurface } from './ui'

const TONE: Record<'info' | 'error' | 'success', string> = {
  info: 'bg-muted',
  error: 'bg-danger',
  success: 'bg-ok',
}

/** Transient messages. Errors stay a little longer, and each can be dismissed. */
export function Toasts() {
  const toasts = useStore((s) => s.toasts)
  return (
    <div className="pointer-events-none fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-2" role="status" aria-live="polite">
      {toasts.map((t) => (
        <button
          key={t.id}
          onClick={() => dismissToast(t.id)}
          className={`pointer-events-auto flex max-w-[520px] animate-[toast-in_220ms_cubic-bezier(0.2,0.8,0.2,1)] items-center gap-3 rounded-lg py-2 pl-3 pr-4 text-left text-[12px] text-ink motion-reduce:animate-none ${floatingSurface}`}
        >
          <span className={`h-2 w-2 shrink-0 rounded-full ${TONE[t.tone]}`} aria-hidden="true" />
          <span className="line-clamp-3">{t.text}</span>
        </button>
      ))}
    </div>
  )
}
