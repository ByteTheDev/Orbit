// The shape of the galaxy around the solar systems. Pure functions, no WebGL or React.
//
// Each project's star contributes a soft cloud of gas and stars. Neighbouring clouds
// overlap, so the field between two projects is denser than the empty space beside
// them: the systems read as one connected formation rather than scattered stars.
// A two-armed spiral modulates the density around a galactic core, which sits at the
// centre of the workspace and is never clickable.
//
// The field is rasterised once into a square grid whenever the set of suns changes.
// The renderer samples the grid on the GPU and places stars by sampling it on the CPU.

export interface Star {
  x: number
  y: number
}

/** A world-space field: density cells over a square centred on the core. */
export interface GalaxyField {
  /** Galactic core, the centroid of the suns. */
  cx: number
  cy: number
  /** Half the side of the square covered by the grid, in world units. */
  half: number
  /** Cells per side. */
  size: number
  /** Density per cell, row-major, rows increasing with world y. Values in [0, 1]. */
  cells: Float32Array
}

/** Spread of each project's cloud, in world units. Wide enough to bridge neighbouring suns. */
export const CLOUD_SIGMA = 1700
/** Radius of the bright core cluster, in world units. */
export const CORE_SIGMA = 420
/** Grid resolution. Cells are about 100 world units wide at the default extent. */
export const FIELD_CELLS = 192
/** Room beyond the outermost sun. The density tapers to nothing before the grid edge, so no square shows. */
const HALO_PAD = 2000
const MIN_HALF = 6000
/**
 * Where the taper starts and ends, as shares of the grid half-side. Beyond the end the density
 * is zero, so the galaxy ends in a soft, round boundary rather than a rectangle.
 */
const TAPER_START = 0.8
const TAPER_END = 0.98

/** Winding of the arms: how far they turn per unit of log radius. */
const WIND = 2.6
const ARM_SCALE = 900

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/**
 * Strength of the two spiral arms at a point, 0 between arms and 1 on an arm's crest.
 * The arms wind more tightly with radius only slowly, so the spiral reads as a galaxy.
 */
export function armStrength(x: number, y: number, cx: number, cy: number): number {
  const dx = x - cx
  const dy = y - cy
  const r = Math.hypot(dx, dy)
  const theta = Math.atan2(dy, dx)
  const wind = WIND * Math.log(r / ARM_SCALE + 1)
  const c = 0.5 + 0.5 * Math.cos(2 * (theta - wind))
  // Cubed: the arms are clearly brighter than the gaps, so the spiral reads at a glance. A small
  // floor keeps the inter-arm space faintly populated so the suns still share one formation.
  return 0.12 + 0.88 * c * c * c
}

/** Fades the field to zero over the outer part of the grid, so its edge is round and soft. */
export function edgeTaper(x: number, y: number, cx: number, cy: number, half: number): number {
  const r = Math.hypot(x - cx, y - cy) / half
  return 1 - smoothstep(TAPER_START, TAPER_END, r)
}

/**
 * Density at a world point: the sum of the project clouds, shaped by the arms, with a faint
 * arm halo that carries the spiral out past the last project.
 */
export function galacticDensity(x: number, y: number, suns: Star[], cx: number, cy: number, half: number): number {
  let cloud = 0
  const inv = 1 / (2 * CLOUD_SIGMA * CLOUD_SIGMA)
  for (const s of suns) {
    const d2 = (x - s.x) * (x - s.x) + (y - s.y) * (y - s.y)
    cloud += Math.exp(-d2 * inv)
  }
  const arm = armStrength(x, y, cx, cy)
  const body = (1 - Math.exp(-1.3 * cloud)) * (0.2 + 0.8 * arm)
  // The disc: the arms themselves, carried across the galaxy between the core and the rim. It is
  // what makes the spiral read as a galaxy, rather than only where the suns cluster.
  const u = Math.hypot(x - cx, y - cy) / half
  const envelope = smoothstep(0.1, 0.35, u) * (1 - smoothstep(0.5, 0.9, u))
  const disc = 1.0 * Math.pow(arm, 2) * envelope
  return Math.min(1, body + disc) * edgeTaper(x, y, cx, cy, half)
}

/**
 * Rasterises the galactic density over the suns. The core sits at the origin, where the layout
 * keeps its empty bulge, so the arms and the core are centred on the same point.
 */
export function buildGalaxyField(suns: Star[]): GalaxyField {
  const cx = 0
  const cy = 0
  let far = 0
  for (const s of suns) far = Math.max(far, Math.hypot(s.x - cx, s.y - cy))
  const half = Math.max(MIN_HALF, far / TAPER_START + HALO_PAD)
  const size = FIELD_CELLS
  const cells = new Float32Array(size * size)
  const step = (2 * half) / size
  for (let j = 0; j < size; j++) {
    const y = cy - half + (j + 0.5) * step
    for (let i = 0; i < size; i++) {
      const x = cx - half + (i + 0.5) * step
      cells[j * size + i] = galacticDensity(x, y, suns, cx, cy, half)
    }
  }
  return { cx, cy, half, size, cells }
}

/**
 * Draws `count` star positions in proportion to the square root of the field's density, using the
 * supplied random source. The square root keeps stars along the whole arm rather than piling into
 * its densest bridges, so the distribution looks natural instead of clumped.
 */
export function sampleFieldStars(field: GalaxyField, count: number, rand: () => number): Star[] {
  const { cells, size, half, cx, cy } = field
  const cdf = new Float64Array(cells.length)
  let total = 0
  for (let k = 0; k < cells.length; k++) {
    total += Math.sqrt(cells[k])
    cdf[k] = total
  }
  const out: Star[] = []
  if (total <= 0) return out
  const step = (2 * half) / size
  for (let n = 0; n < count; n++) {
    const u = rand() * total
    let lo = 0
    let hi = cdf.length - 1
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (cdf[mid] < u) lo = mid + 1
      else hi = mid
    }
    const i = lo % size
    const j = Math.floor(lo / size)
    out.push({ x: cx - half + (i + rand()) * step, y: cy - half + (j + rand()) * step })
  }
  return out
}

/** Stars of the bright core: a Gaussian cluster around the galactic centre. */
export function sampleCoreStars(field: GalaxyField, count: number, rand: () => number): Star[] {
  const out: Star[] = []
  for (let n = 0; n < count; n++) {
    // Box-Muller for a Gaussian offset.
    const u1 = Math.max(1e-6, rand())
    const u2 = rand()
    const mag = Math.sqrt(-2 * Math.log(u1)) * CORE_SIGMA
    out.push({ x: field.cx + mag * Math.cos(2 * Math.PI * u2), y: field.cy + mag * Math.sin(2 * Math.PI * u2) })
  }
  return out
}

/** Opacity of the galactic structure at a camera zoom: full when zoomed out, giving way to the local system when zoomed in. */
export function galaxyFade(zoom: number): number {
  return 1 - 0.8 * smoothstep(0.6, 1.6, zoom)
}
