/**
 * Shown while Orbit connects to its backend. A small orbit diagram stands for the app's idea:
 * a project is a sun, and each agent is a planet on its own orbit. Motion stops under reduced motion.
 */
export function StartupScreen() {
  return (
    <div role="status" aria-live="polite" className="flex h-full flex-col items-center justify-center bg-canvas px-8">
      <div className="relative h-40 w-40 animate-rise-in motion-reduce:animate-none" aria-hidden="true">
        {/* Sun: a soft white core with a faint halo. */}
        <span className="absolute left-1/2 top-1/2 h-9 w-9 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle_at_34%_30%,#ffffff,#d4d4d8_58%,#52525b)] shadow-[0_0_44px_8px_rgb(244_244_245/0.07)]" />

        {/* Two orbits, drawn as hairlines. */}
        <span className="absolute inset-[34px] rounded-full border border-tint/[0.08]" />
        <span className="absolute inset-[10px] rounded-full border border-tint/[0.04]" />

        {/* Inner planet, Claude's terracotta. */}
        <span className="absolute inset-[34px] animate-orbit motion-reduce:animate-none">
          <span
            className="absolute -top-[3.5px] left-1/2 h-[7px] w-[7px] -translate-x-1/2 rounded-full"
            style={{ background: 'radial-gradient(circle at 34% 30%, var(--color-claude-glow), var(--color-claude))', boxShadow: '0 0 10px var(--color-claude-glow)' }}
          />
        </span>

        {/* Outer planet, Codex's pale white. */}
        <span className="absolute inset-[10px] animate-orbit-slow motion-reduce:animate-none">
          <span className="absolute -bottom-[3px] left-1/2 h-[6px] w-[6px] -translate-x-1/2 rounded-full bg-codex shadow-[0_0_8px_var(--color-codex-glow)]" />
        </span>
      </div>

      <p className="mt-6 text-display font-semibold tracking-[-0.02em] text-ink">Orbit</p>
      <p className="mt-2 text-caption text-faint">Starting Orbit…</p>
    </div>
  )
}
