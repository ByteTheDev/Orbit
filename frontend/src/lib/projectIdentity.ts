// A project's visual identity: one accent colour and one symbol, chosen once from its id.
// The sidebar tile and the galaxy's star both read from here, so a project looks the same
// everywhere. Pure data: no DOM, no React, no canvas. Callers decide how to draw it.

/** Accents chosen to sit well on near-black. Each is clear of the others in hue and lightness. */
export const ACCENTS = [
  '#e9b26b', // amber
  '#e88a9a', // rose
  '#6cc9b8', // teal
  '#a594f0', // violet
  '#86bdf0', // sky
  '#bfd977', // lime
  '#ee8462', // coral
  '#c9cfe0', // mist
] as const

/**
 * Symbols as 24×24 stroke paths (round caps, 1.6 stroke at full size). Each reads at 12px.
 * The same strings drive the sidebar SVG and the canvas Path2D.
 */
export const GLYPHS = {
  orbit: 'M2.5 12a9.5 4.2 0 1 0 19 0a9.5 4.2 0 1 0-19 0M12 9.2a2.8 2.8 0 1 0 0 5.6a2.8 2.8 0 1 0 0-5.6',
  prism: 'M12 3.5L20.5 18.5H3.5Z',
  hex: 'M12 3L19.8 7.5V16.5L12 21L4.2 16.5V7.5Z',
  spark: 'M12 3.2C12.7 8.9 14.9 11.3 20.8 12C14.9 12.7 12.7 15.1 12 20.8C11.3 15.1 9.1 12.7 3.2 12C9.1 11.3 11.3 8.9 12 3.2Z',
  terminal: 'M3.5 5.5H20.5V18.5H3.5Z M7 10L9.5 12.5L7 15 M12.5 15H17',
  diamond: 'M12 2.8L21.2 12L12 21.2L2.8 12Z M12 7.5L16.5 12L12 16.5L7.5 12Z',
  cube: 'M12 3L19.5 7.2V16.8L12 21L4.5 16.8V7.2Z M4.5 7.2L12 11.4L19.5 7.2 M12 11.4V21',
  wave: 'M2.5 14.5C6 8 9.5 8 12 12S18 16.5 21.5 9.5 M12 3.2a1.4 1.4 0 1 0 0 2.8a1.4 1.4 0 1 0 0-2.8',
} as const

export type GlyphName = keyof typeof GLYPHS

export interface ProjectIdentity {
  accent: string
  glyph: GlyphName
  glyphPath: string
}

const GLYPH_NAMES = Object.keys(GLYPHS) as GlyphName[]

/** FNV-1a: a stable hash, so a project keeps its identity across sessions and restarts. */
export function hashId(id: string): number {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

const cache = new Map<string, ProjectIdentity>()

/** The identity for a project id. Accent and symbol come from different bits of the hash, so they vary independently. */
export function identityFor(projectId: string): ProjectIdentity {
  const hit = cache.get(projectId)
  if (hit) return hit
  const h = hashId(projectId)
  const glyph = GLYPH_NAMES[h % GLYPH_NAMES.length]
  const identity: ProjectIdentity = {
    accent: ACCENTS[(h >>> 8) % ACCENTS.length],
    glyph,
    glyphPath: GLYPHS[glyph],
  }
  if (cache.size > 2000) cache.clear()
  cache.set(projectId, identity)
  return identity
}
