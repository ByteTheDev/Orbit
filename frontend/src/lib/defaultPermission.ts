// The default permission mode per provider: the mode a new agent starts with. Pure, so the rules can be
// tested without React or storage. Mirrors defaultModel.ts.

/** Modes that let the agent act without asking. Settings warns when one is chosen as a default. */
export const RISKY_PERMISSION_MODES: ReadonlySet<string> = new Set(['bypassPermissions', 'danger-full-access', 'full-access'])

/** The saved default permission mode id for each provider id. A provider missing from the map uses its own first mode. */
export type DefaultPermissions = Record<string, string>

/** Keeps only non-empty strings, trimmed. Anything else is dropped rather than failing the settings load. */
export function normaliseDefaultPermissions(raw: unknown): DefaultPermissions {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: DefaultPermissions = {}
  for (const [providerId, mode] of Object.entries(raw)) {
    if (typeof mode === 'string' && mode.trim() !== '') out[providerId] = mode.trim()
  }
  return out
}

/**
 * The permission mode a new agent on this provider starts with: the saved default when the provider
 * still offers it, otherwise '' (the provider's first mode, which the caller falls back to).
 */
export function defaultPermissionFor(defaults: DefaultPermissions, providerId: string, offered: { id: string }[]): string {
  const saved = defaults[providerId]
  return saved && offered.some((m) => m.id === saved) ? saved : ''
}

/** The map after the user picks `mode` for one provider. An empty pick removes that provider's saved default. */
export function withDefaultPermission(defaults: DefaultPermissions, providerId: string, mode: string): DefaultPermissions {
  const next = { ...defaults }
  if (mode.trim()) next[providerId] = mode.trim()
  else delete next[providerId]
  return next
}
