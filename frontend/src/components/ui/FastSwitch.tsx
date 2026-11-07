import { useState } from 'react'
import { MaterialIcon } from './icons'

/*
 * Fast mode's switch: a pill track with a Material Symbols bolt riding in a knob. Off it is quiet
 * and outlined; on it floods amber, the knob turns white and the bolt fills and kicks. Each turn-on
 * sends a light sweep across the track and a ring out from it. The parent button is the switch
 * (role="switch"); this draws the state and owns the one-shot effect.
 */
export function FastSwitch({
  on,
  disabled = false,
  labelledBy,
  ariaLabel,
  compact = false,
  onChange,
}: {
  on: boolean
  disabled?: boolean
  /** The id of the visible label. Use this, or ariaLabel when there is no visible label. */
  labelledBy?: string
  ariaLabel?: string
  /** A smaller track for the chat composer's control row. */
  compact?: boolean
  onChange: (on: boolean) => void
}) {
  // Bumped on each turn-on. Keying the effect on it replays the animation every time.
  const [burst, setBurst] = useState(0)
  const track = compact ? 'h-[22px] w-10' : 'h-7 w-[52px]'
  const knob = compact ? 'h-4 w-4' : 'h-6 w-6'
  const travel = compact ? 'translate-x-[18px]' : 'translate-x-6'
  const boltSize = compact ? 10 : 15

  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-labelledby={labelledBy}
      aria-label={labelledBy ? undefined : ariaLabel}
      disabled={disabled}
      onClick={() => {
        if (!on) setBurst((n) => n + 1)
        onChange(!on)
      }}
      className={`relative ${track} shrink-0 overflow-hidden rounded-full border outline-none transition-[background-color,border-color,box-shadow] duration-300 focus-visible:ring-[3px] focus-visible:ring-tint/[0.08] disabled:cursor-not-allowed disabled:opacity-40 ${
        on
          ? 'border-amber-200/50 bg-gradient-to-r from-amber-500 via-amber-400 to-yellow-300 shadow-[0_0_18px_-2px_rgba(251,191,36,0.6)]'
          : 'border-line-strong bg-tint/[0.04] hover:bg-tint/[0.07]'
      }`}
    >
      {on && (
        <span key={burst} aria-hidden="true" className="fast-burst pointer-events-none absolute inset-0 overflow-hidden rounded-full">
          <span className="fast-burst-sweep absolute inset-y-0 left-0 w-1/2" />
        </span>
      )}
      <span
        aria-hidden="true"
        className={`absolute left-0.5 top-0.5 flex ${knob} items-center justify-center rounded-full shadow-[0_1px_3px_rgba(0,0,0,0.35)] transition-[transform,background-color] duration-300 ${
          on ? `${travel} bg-white` : 'translate-x-0 bg-faint/70'
        }`}
        style={{ transitionTimingFunction: 'var(--ease-spring)' }}
      >
        <span key={on ? burst : 'rest'} className={on ? 'fast-bolt-kick inline-flex' : 'inline-flex'}>
          <MaterialIcon
            name="bolt"
            size={boltSize}
            className={on ? 'text-amber-600' : 'text-canvas'}
            style={{ fontVariationSettings: on ? '"FILL" 1' : '"FILL" 0' }}
          />
        </span>
      </span>
    </button>
  )
}
