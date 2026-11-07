/** Searching and grouping the model list. Pure, so the picker can be unit-tested without React. */

export interface SearchableModel {
  id: string
  label: string
  group: string
  description: string
}

/**
 * Keeps models whose label, id, group or description contains every word of the query.
 * Matching ignores case. An empty query keeps everything, in the original order.
 */
export function filterModels<T extends SearchableModel>(models: T[], query: string): T[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return models
  return models.filter((m) => {
    const haystack = `${m.label} ${m.id} ${m.group} ${m.description}`.toLowerCase()
    return words.every((w) => haystack.includes(w))
  })
}

/** Groups models under their group name. Groups keep the order they first appear in. */
export function groupModels<T extends SearchableModel>(models: T[]): { group: string; items: T[] }[] {
  const order: string[] = []
  const byGroup = new Map<string, T[]>()
  for (const m of models) {
    const bucket = byGroup.get(m.group)
    if (bucket) {
      bucket.push(m)
    } else {
      byGroup.set(m.group, [m])
      order.push(m.group)
    }
  }
  return order.map((group) => ({ group, items: byGroup.get(group) ?? [] }))
}
