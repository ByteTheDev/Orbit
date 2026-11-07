import { ProviderMark } from './index'
import { SwitchGlyph } from './icons'

/*
 * The team header in the launch dialog. The first agent's mark sits on the left, and each agent added
 * to the team follows it along a connector. Adding one draws its link out and pops its mark in, because
 * the elements mount then. The parent button is the switch (role="switch"); this draws the state only.
 */
export function PartnerLink({
  primary,
  partners,
  on,
  disabled = false,
  onChange,
}: {
  primary: string
  /** Provider ids of the agents added so far, in order. */
  partners: string[]
  on: boolean
  disabled?: boolean
  onChange: (on: boolean) => void
}) {
  const count = partners.length
  const summary = !on
    ? 'Turn this on to take turns on the task with other agents.'
    : count === 0
      ? 'Add the agents to work with below.'
      : `${count} ${count === 1 ? 'agent joins' : 'agents join'} the first one. They take turns on the task in the same folder.`

  return (
    <div className={`flex items-center gap-3 rounded-md border px-3 py-2.5 transition-colors duration-300 ${on ? 'border-tint/20 bg-tint/[0.03]' : 'border-line'} ${disabled ? 'opacity-60' : ''}`}>
      <div className="flex min-w-0 shrink items-center overflow-hidden" aria-hidden="true">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-line bg-surface">
          <ProviderMark provider={primary} size={16} />
        </span>
        {on &&
          partners.map((id, i) => (
            <span key={`${id}-${i}`} className="flex items-center">
              <span className="relative mx-1.5 h-[22px] w-[28px] shrink-0">
                <svg className="absolute inset-0 h-full w-full overflow-visible" viewBox="0 0 28 22" preserveAspectRatio="none">
                  <line x1="0" y1="11" x2="28" y2="11" pathLength={1} strokeWidth={1.5} strokeLinecap="round" className="partner-line stroke-tint/70" />
                </svg>
                <span className="partner-spark absolute left-0 top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-tint shadow-[0_0_8px_2px_rgba(255,255,255,0.55)]" />
              </span>
              <span className="partner-pop flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-tint/25 bg-surface">
                <ProviderMark provider={id} size={16} />
              </span>
            </span>
          ))}
        {on && count === 0 && (
          <span className="ml-1.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-dashed border-line-strong text-faint">
            <span className="text-[13px] leading-none">+</span>
          </span>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <p id="launch-team-label" className="text-caption font-medium text-ink">
          Work with other agents
        </p>
        <p className="text-[11px] leading-tight text-faint">{summary}</p>
      </div>

      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-labelledby="launch-team-label"
        disabled={disabled}
        onClick={() => onChange(!on)}
        className="shrink-0 rounded-md outline-none transition-opacity duration-150 hover:opacity-80 focus-visible:ring-[3px] focus-visible:ring-tint/[0.08] disabled:cursor-not-allowed disabled:opacity-40"
      >
        <SwitchGlyph on={on} size={30} />
      </button>
    </div>
  )
}
