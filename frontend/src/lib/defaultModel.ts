// The default model per provider: the model a new agent starts with. Pure, so the rules can be
// tested without React or storage.

/** The saved default model id for each provider id. A provider missing from the map uses its own default. */
export type DefaultModels = Record<string, string>

/** Keeps only non-empty strings, trimmed. Anything else is dropped rather than failing the settings load. */
export function normaliseDefaultModels(raw: unknown): DefaultModels {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: DefaultModels = {}
  for (const [providerId, model] of Object.entries(raw)) {
    if (typeof model === 'string' && model.trim() !== '') out[providerId] = model.trim()
  }
  return out
}

/**
 * The model a new agent on this provider starts with: the saved default when the provider still
 * offers it, otherwise '' (the provider's own default).
 */
export function defaultModelFor(defaults: DefaultModels, providerId: string, offered: { id: string }[]): string {
  const saved = defaults[providerId]
  return saved && offered.some((m) => m.id === saved) ? saved : ''
}

/** The map after the user picks `model` for one provider. An empty pick removes that provider's saved default. */
export function withDefaultModel(defaults: DefaultModels, providerId: string, model: string): DefaultModels {
  const next = { ...defaults }
  if (model.trim()) next[providerId] = model.trim()
  else delete next[providerId]
  return next
}
