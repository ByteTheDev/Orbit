// The galaxy background: a procedural nebula and parallax star field, drawn with WebGL.
//
// Isolation: this module knows nothing about projects, agents or React. The universe
// hands it a camera (world centre and zoom) and a size; it owns its canvases, shaders,
// buffers and animation loop. If WebGL is unavailable, createGalaxy returns null and
// the caller falls back to the plain backdrop.
//
// Three layers, back to front:
//   1. the sky: a screen-space nebula and a tiled parallax star field, for depth;
//   2. the galactic structure: dust, gas and a bright core, in world space, shaded from
//      a density field the universe hands over (see galaxyShape.ts), so it stays put
//      under the suns as the camera moves;
//   3. world-space stars sampled from that field, plus the core cluster.
// The structure fades as the camera zooms into a solar system.
//
// Cost model: the nebula passes are shaded at half resolution (they are soft, so this
// costs nothing visible) and stretched by the browser. Stars are a few thousand GL points,
// one draw call per layer. The loop runs at 30 fps, pauses while the document is hidden,
// and freezes time when the user prefers reduced motion.
import { galaxyFade, sampleCoreStars, sampleFieldStars, type GalaxyField } from './galaxyShape'

export interface GalaxyView {
  /** World point at the centre of the screen. */
  camX: number
  camY: number
  zoom: number
}

export interface Galaxy {
  resize(w: number, h: number, dpr: number): void
  setView(view: GalaxyView): void
  /** Replaces the galactic structure. Pass null to show the sky alone. */
  setField(field: GalaxyField | null): void
  setReducedMotion(reduced: boolean): void
  destroy(): void
}

/** Side of the square tile the star field repeats over, in CSS pixels. */
const TILE_CSS = 2600
const FRAME_MS = 33
/** The nebula drifts slowly, so it is shaded about 11 times a second rather than every frame. */
const NEBULA_MS = 90
/** Nebula shading resolution, relative to the canvas's device pixels. */
const NEBULA_SCALE = 1.0

interface StarLayer {
  count: number
  /** Parallax factor: how much this layer moves with the camera relative to the sky. */
  parallax: number
  /** Stars per layer, brightest and largest first. */
  seedOffset: number
  sizeScale: number
  brightness: number
}

const LAYERS: StarLayer[] = [
  { count: 3800, parallax: 0.03, seedOffset: 11, sizeScale: 0.8, brightness: 0.55 },
  { count: 2200, parallax: 0.1, seedOffset: 23, sizeScale: 1.0, brightness: 0.8 },
  { count: 640, parallax: 0.24, seedOffset: 37, sizeScale: 1.35, brightness: 1.0 },
]

const NEBULA_VERT = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`

const NEBULA_FRAG = `
precision highp float;
uniform vec2 uRes;
uniform vec2 uOff;
uniform float uTime;
uniform float uScale;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  mat2 r = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 5; i++) {
    v += a * noise(p);
    p = r * p;
    a *= 0.5;
  }
  return v;
}

void main() {
  vec2 px = gl_FragCoord.xy;
  vec2 uv = px / uRes;
  vec2 q = px - uRes * 0.5 + uOff;
  // 0.85 enlarges the cloud features by about 18% (1 / 0.85) without changing the drift speed.
  float s = 1.0 / (uRes.y * 0.9) * uScale * 0.85;

  // Far cloud: large, slow, domain-warped so it reads as gas rather than noise.
  vec2 p1 = q * s * 1.5;
  vec2 w = vec2(fbm(p1 + vec2(uTime * 0.02, 0.0)), fbm(p1 + vec2(5.2, 1.3) - vec2(uTime * 0.015, 0.0)));
  float n1 = fbm(p1 + 1.8 * w);

  // Mid layer: finer structure and dust lanes that darken what lies behind them.
  vec2 p2 = q * s * 3.1;
  float dust = smoothstep(0.46, 0.78, fbm(p2 + vec2(2.0, uTime * 0.01)));
  float n2 = fbm(p2 * 1.1 + 2.0 * vec2(fbm(p2 + 3.1), fbm(p2 - 1.7)));

  vec3 base = vec3(0.027, 0.030, 0.060);
  vec3 blue = vec3(0.10, 0.20, 0.44);
  vec3 violet = vec3(0.32, 0.14, 0.50);
  vec3 red = vec3(0.48, 0.13, 0.19);
  vec3 orange = vec3(0.90, 0.48, 0.20);
  vec3 gold = vec3(1.0, 0.80, 0.46);

  // A tilted band of denser gas, like the plane of a galaxy seen from inside it.
  vec2 r = vec2(q.x * 0.86 - q.y * 0.5, q.x * 0.5 + q.y * 0.86);
  float band = exp(-pow(r.y / (uRes.y * 0.26), 2.0));
  // Kept quiet: the galactic structure carries the spiral, so the sky is only a faint backdrop.
  float density = 0.3 + 0.3 * band;
  vec3 col = base;
  col += mix(blue, violet, smoothstep(0.35, 0.72, n1)) * smoothstep(0.28, 0.80, n1) * 0.9 * density;
  col += mix(red, orange, smoothstep(0.50, 0.85, n2)) * smoothstep(0.40, 0.86, n2) * 0.7 * density;
  col += gold * pow(smoothstep(0.72, 0.96, n2), 2.0) * 0.5 * (0.6 + band);
  // A soft bright core near the centre of the sky.
  col += vec3(0.22, 0.14, 0.09) * exp(-dot(q, q) / (uRes.y * uRes.y * 0.09)) * 0.8;
  col *= 1.0 - dust * 0.55;

  // Darker toward the edges, so the middle of the screen is the brightest part.
  float vig = smoothstep(1.2, 0.3, length(uv - 0.5) * 1.5);
  col *= mix(0.5, 1.0, vig);

  gl_FragColor = vec4(col, 1.0);
}
`

const STAR_VERT = `
attribute vec2 aPos;
attribute float aSize;
attribute float aBright;
attribute vec3 aColor;
attribute float aPhase;
attribute float aSpeed;
uniform vec2 uRes;
uniform vec2 uOff;
uniform float uTile;
uniform float uTime;
uniform float uDpr;
uniform float uTwinkle;
varying float vB;
varying vec3 vC;
void main() {
  // The sky repeats every uTile device pixels, so a layer covers any screen with a fixed star count.
  vec2 p = mod(aPos * uTile - uOff, uTile);
  vec2 clip = p / uRes * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  float tw = 1.0 - uTwinkle * (0.5 + 0.5 * sin(uTime * aSpeed + aPhase));
  vB = aBright * tw;
  vC = aColor;
  gl_PointSize = aSize * uDpr * (1.0 + 2.5 * aBright * aBright);
}
`

const STAR_FRAG = `
precision mediump float;
varying float vB;
varying vec3 vC;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float core = smoothstep(0.42, 0.0, d);
  float halo = pow(max(0.0, 1.0 - d), 3.0) * 0.28;
  float a = (core + halo) * vB;
  gl_FragColor = vec4(vC * a, a);
}
`

/**
 * The galactic structure. Runs after the sky with premultiplied output: rgb adds light,
 * alpha darkens what lies behind it, so gas glows and dust lanes cut into it.
 * Position comes from the camera, so the structure lies still under the suns.
 */
const GALAXY_FRAG = `
precision highp float;
uniform vec2 uRes;
uniform float uPx;
uniform vec2 uCam;
uniform float uZoom;
uniform sampler2D uField;
uniform vec2 uFieldC;
uniform float uHalf;
uniform vec2 uCore;
uniform float uFade;
uniform float uTime;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  mat2 r = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 5; i++) {
    v += a * noise(p);
    p = r * p;
    a *= 0.5;
  }
  return v;
}

void main() {
  // Device pixel to world: y is flipped, as the canvas grows downwards.
  vec2 css = vec2(gl_FragCoord.x - uRes.x * 0.5, uRes.y * 0.5 - gl_FragCoord.y) / uPx;
  vec2 W = uCam + css / uZoom;

  // Density from the project clouds and the spiral, sampled from the field grid.
  float D = texture2D(uField, (W - uFieldC) / (2.0 * uHalf) + 0.5).r;

  // Gas colour and dust inside the density: fine, slowly drifting structure.
  vec2 q = W * 0.0021;
  float n = fbm(q + vec2(uTime * 0.004, 0.0));
  float n2 = fbm(q * 2.3 + vec2(3.7, 1.1));
  vec3 blue = vec3(0.16, 0.27, 0.62);
  vec3 violet = vec3(0.42, 0.20, 0.60);
  vec3 rose = vec3(0.62, 0.22, 0.34);
  vec3 gold = vec3(1.0, 0.78, 0.48);

  // Density is pushed through a curve so the arms stand out from the gaps between them.
  float Dc = pow(D, 1.25);
  vec3 glow = mix(blue, violet, smoothstep(0.3, 0.7, n)) * Dc * 0.95;
  glow += mix(rose, gold, smoothstep(0.55, 0.9, n2)) * Dc * Dc * 0.3 * smoothstep(0.45, 0.9, n);

  // The galactic core: a warm, deep bulge. Its brightest point is kept well below clipping, so it
  // reads as depth rather than a blown-out blob.
  vec2 dc = W - uCore;
  float rc2 = dot(dc, dc);
  glow += vec3(0.95, 0.62, 0.36) * exp(-rc2 / (2.0 * 1500.0 * 1500.0)) * 0.22;
  glow += vec3(1.0, 0.8, 0.52) * exp(-rc2 / (2.0 * 640.0 * 640.0)) * 0.14;
  glow += vec3(1.0, 0.9, 0.7) * exp(-rc2 / (2.0 * 220.0 * 220.0)) * 0.08;
  glow += vec3(0.4, 0.2, 0.12) * exp(-rc2 / (2.0 * 3600.0 * 3600.0)) * 0.12;

  // Dust lanes sit where the density is substantial and the dust noise is high.
  float lane = smoothstep(0.42, 0.75, n2) * smoothstep(0.05, 0.5, D);
  float dust = clamp(lane * 0.6, 0.0, 0.6);

  gl_FragColor = vec4(glow * uFade, dust * uFade);
}
`

/**
 * World-space stars. Positions are in world units, so the layer moves with the suns and
 * stays put under the camera; the fragment stage is shared with the sky stars.
 */
const WORLD_STAR_VERT = `
attribute vec2 aPos;
attribute float aSize;
attribute float aBright;
attribute vec3 aColor;
attribute float aPhase;
attribute float aSpeed;
uniform vec2 uRes;
uniform vec2 uCam;
uniform float uZoom;
uniform float uDpr;
uniform float uTime;
uniform float uTwinkle;
uniform float uFade;
varying float vB;
varying vec3 vC;
void main() {
  vec2 s = (aPos - uCam) * uZoom * uDpr + uRes * 0.5;
  gl_Position = vec4(s.x / uRes.x * 2.0 - 1.0, 1.0 - s.y / uRes.y * 2.0, 0.0, 1.0);
  float tw = 1.0 - uTwinkle * (0.5 + 0.5 * sin(uTime * aSpeed + aPhase));
  vB = aBright * tw * uFade;
  vC = aColor;
  gl_PointSize = aSize * uDpr * (0.7 + 0.5 * min(uZoom, 1.6)) * (1.0 + 2.0 * aBright * aBright);
}
`

/** Deterministic PRNG so the sky is the same every time the universe opens. */
function rng(seed: number): () => number {
  let s = seed >>> 0 || 1
  return () => {
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    return (s >>> 0) / 4294967296
  }
}

/** Star colour by temperature: hot blue-white through white and gold to a dim orange. */
function starColor(t: number): [number, number, number] {
  if (t < 0.25) return [0.72, 0.82, 1.0]
  if (t < 0.6) return [1.0, 1.0, 1.0]
  if (t < 0.85) return [1.0, 0.92, 0.78]
  return [1.0, 0.72, 0.5]
}

/** Packs one layer's stars into an interleaved buffer: pos, size, brightness, colour, phase, speed. */
function buildLayer(layer: StarLayer, index: number): Float32Array {
  const rand = rng(0x9e3779b9 ^ (layer.seedOffset * 2654435761))
  const stride = 9
  const data = new Float32Array(layer.count * stride)
  for (let i = 0; i < layer.count; i++) {
    const o = i * stride
    const r = rand()
    // Most stars are faint and small; a few are bright and large, as in a real field.
    const mag = Math.pow(rand(), 3)
    const size = (0.9 + mag * 2.6) * layer.sizeScale
    const bright = (0.25 + 0.75 * (1 - mag)) * layer.brightness * (index === 2 ? 1 : 0.9)
    const [cr, cg, cb] = starColor(rand())
    data[o] = rand()
    data[o + 1] = rand()
    data[o + 2] = size
    data[o + 3] = Math.min(1, bright * (0.6 + 0.4 * r))
    data[o + 4] = cr
    data[o + 5] = cg
    data[o + 6] = cb
    data[o + 7] = rand() * Math.PI * 2
    data[o + 8] = 0.6 + rand() * 1.6
  }
  return data
}

/** Binds the interleaved star buffer (9 floats per star) to a star program's attributes. */
function bindStarAttributes(gl: WebGLRenderingContext, prog: WebGLProgram, buffer: WebGLBuffer): void {
  const attrs: [string, number][] = [
    ['aPos', 2],
    ['aSize', 1],
    ['aBright', 1],
    ['aColor', 3],
    ['aPhase', 1],
    ['aSpeed', 1],
  ]
  const stride = 9 * 4
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  let offset = 0
  for (const [name, size] of attrs) {
    const loc = gl.getAttribLocation(prog, name)
    if (loc >= 0) {
      gl.enableVertexAttribArray(loc)
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, offset)
    }
    offset += size * 4
  }
}

/**
 * Packs the galactic stars: positions sampled from the field, plus the warmer core cluster.
 * Same 9-float layout as the sky layers, with world coordinates in place of tile coordinates.
 */
function buildWorldStars(field: GalaxyField): { data: Float32Array; count: number } {
  const rand = rng(0x51ed270b ^ field.size)
  const disc = sampleFieldStars(field, 2800, rand)
  const core = sampleCoreStars(field, 420, rand)
  const stride = 9
  const count = disc.length + core.length
  const data = new Float32Array(count * stride)
  const write = (i: number, x: number, y: number, size: number, bright: number, color: [number, number, number]) => {
    const o = i * stride
    data[o] = x
    data[o + 1] = y
    data[o + 2] = size
    data[o + 3] = Math.min(1, bright)
    data[o + 4] = color[0]
    data[o + 5] = color[1]
    data[o + 6] = color[2]
    data[o + 7] = rand() * Math.PI * 2
    data[o + 8] = 0.6 + rand() * 1.6
  }
  disc.forEach((s, i) => {
    const mag = Math.pow(rand(), 3)
    write(i, s.x, s.y, 0.7 + mag * 2.4, 0.18 + 0.5 * (1 - mag), starColor(rand()))
  })
  core.forEach((s, k) => {
    const r = rand()
    write(disc.length + k, s.x, s.y, 0.8 + r * 1.2, 0.28 + 0.34 * r, [1.0, 0.8 + 0.12 * r, 0.52 + 0.2 * r])
  })
  return { data, count }
}

function compile(gl: WebGLRenderingContext, type: number, src: string): WebGLShader {
  const shader = gl.createShader(type)
  if (!shader) throw new Error('createShader failed')
  gl.shaderSource(shader, src)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? 'unknown error'
    gl.deleteShader(shader)
    throw new Error(`shader compile failed: ${log}`)
  }
  return shader
}

function program(gl: WebGLRenderingContext, vs: string, fs: string): WebGLProgram {
  const p = gl.createProgram()
  if (!p) throw new Error('createProgram failed')
  const v = compile(gl, gl.VERTEX_SHADER, vs)
  const f = compile(gl, gl.FRAGMENT_SHADER, fs)
  gl.attachShader(p, v)
  gl.attachShader(p, f)
  gl.linkProgram(p)
  gl.deleteShader(v)
  gl.deleteShader(f)
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(p) ?? 'unknown error'
    gl.deleteProgram(p)
    throw new Error(`program link failed: ${log}`)
  }
  return p
}

interface GpuLayer {
  buffer: WebGLBuffer
  count: number
  parallax: number
}

/**
 * Creates the galaxy inside `container`, behind whatever is drawn there next. Returns null
 * when WebGL is unavailable, so the caller can fall back to its 2D backdrop.
 */
export function createGalaxy(container: HTMLElement): Galaxy | null {
  const nebulaCanvas = document.createElement('canvas')
  const starCanvas = document.createElement('canvas')
  for (const c of [nebulaCanvas, starCanvas]) {
    c.className = 'absolute inset-0 block pointer-events-none'
    c.setAttribute('aria-hidden', 'true')
  }

  const nebulaGl = nebulaCanvas.getContext('webgl', { alpha: false, antialias: false, depth: false, stencil: false }) as WebGLRenderingContext | null
  const starGl = starCanvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false }) as WebGLRenderingContext | null
  if (!nebulaGl || !starGl) return null

  // State shared by both contexts.
  let view: GalaxyView = { camX: 0, camY: 0, zoom: 1 }
  let w = 1
  let h = 1
  let dpr = 1
  let reduced = false
  let destroyed = false
  let timer = 0
  const t0 = performance.now()
  let pausedAt = 0
  let timeOffset = 0
  let lastNebula = -Infinity
  let nebulaDirty = true

  let nebulaProg: WebGLProgram | null = null
  let nebulaBuf: WebGLBuffer | null = null
  let galaxyProg: WebGLProgram | null = null
  let fieldTex: WebGLTexture | null = null
  let starProg: WebGLProgram | null = null
  let worldProg: WebGLProgram | null = null
  let worldBuf: WebGLBuffer | null = null
  let worldCount = 0
  let layers: GpuLayer[] = []
  /** The galactic density the structure is shaded from; null shows the sky alone. */
  let field: GalaxyField | null = null

  const initNebula = (gl: WebGLRenderingContext) => {
    nebulaProg = program(gl, NEBULA_VERT, NEBULA_FRAG)
    galaxyProg = program(gl, NEBULA_VERT, GALAXY_FRAG)
    nebulaBuf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, nebulaBuf)
    // One triangle strip that covers clip space.
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    fieldTex = null
    uploadField()
  }

  const initStars = (gl: WebGLRenderingContext) => {
    starProg = program(gl, STAR_VERT, STAR_FRAG)
    worldProg = program(gl, WORLD_STAR_VERT, STAR_FRAG)
    layers = LAYERS.map((layer, i) => {
      const buffer = gl.createBuffer()
      if (!buffer) throw new Error('createBuffer failed')
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
      gl.bufferData(gl.ARRAY_BUFFER, buildLayer(layer, i), gl.STATIC_DRAW)
      return { buffer, count: layer.count, parallax: layer.parallax }
    })
    worldBuf = null
    uploadWorld()
  }

  /** Uploads the density field as a texture. Sampled with linear filtering, so no mipmaps are needed. */
  const uploadField = () => {
    const gl = nebulaGl
    if (!gl || !field) return
    const bytes = new Uint8Array(field.cells.length)
    for (let k = 0; k < bytes.length; k++) bytes[k] = Math.round(Math.min(1, Math.max(0, field.cells[k])) * 255)
    const tex = gl.createTexture()
    if (!tex) return
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, field.size, field.size, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, bytes)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    fieldTex = tex
  }

  /** Samples the galactic stars from the field and uploads them. */
  const uploadWorld = () => {
    const gl = starGl
    if (!gl || !field) return
    const { data, count } = buildWorldStars(field)
    const buf = gl.createBuffer()
    if (!buf) return
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW)
    worldBuf = buf
    worldCount = count
  }

  try {
    initNebula(nebulaGl)
    initStars(starGl)
  } catch {
    return null
  }

  // Both canvases sit behind everything else in the universe.
  container.insertBefore(starCanvas, container.firstChild)
  container.insertBefore(nebulaCanvas, container.firstChild)

  const time = (now: number): number => {
    if (reduced) return pausedAt || 0
    return (now - t0) / 1000 + timeOffset
  }

  const drawNebula = (now: number) => {
    const gl = nebulaGl
    const prog = nebulaProg
    if (!gl || !prog || !nebulaBuf) return
    const scale = NEBULA_SCALE * dpr
    const cw = Math.max(1, Math.floor(w * scale))
    const ch = Math.max(1, Math.floor(h * scale))
    if (nebulaCanvas.width !== cw || nebulaCanvas.height !== ch) {
      nebulaCanvas.width = cw
      nebulaCanvas.height = ch
    }
    nebulaCanvas.style.width = `${w}px`
    nebulaCanvas.style.height = `${h}px`
    gl.viewport(0, 0, cw, ch)
    gl.useProgram(prog)
    gl.bindBuffer(gl.ARRAY_BUFFER, nebulaBuf)
    const loc = gl.getAttribLocation(prog, 'aPos')
    gl.enableVertexAttribArray(loc)
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)
    // The nebula drifts a little slower than the stars: it sits far behind them.
    const offX = view.camX * view.zoom * 0.08 * scale
    const offY = view.camY * view.zoom * 0.08 * scale
    gl.uniform2f(gl.getUniformLocation(prog, 'uRes'), cw, ch)
    gl.uniform2f(gl.getUniformLocation(prog, 'uOff'), offX, offY)
    gl.uniform1f(gl.getUniformLocation(prog, 'uTime'), time(now) * 0.8)
    gl.uniform1f(gl.getUniformLocation(prog, 'uScale'), scale)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    drawStructure(gl, cw, ch, scale, time(now))
  }

  /** The galactic structure, blended over the sky in the same canvas. */
  const drawStructure = (gl: WebGLRenderingContext, cw: number, ch: number, scale: number, t: number) => {
    const prog = galaxyProg
    const f = field
    if (!prog || !f || !fieldTex || !nebulaBuf) return
    const fade = galaxyFade(view.zoom)
    if (fade < 0.01) return
    gl.enable(gl.BLEND)
    // Premultiplied: rgb adds light, alpha darkens what lies behind.
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    gl.useProgram(prog)
    gl.bindBuffer(gl.ARRAY_BUFFER, nebulaBuf)
    const loc = gl.getAttribLocation(prog, 'aPos')
    gl.enableVertexAttribArray(loc)
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, fieldTex)
    gl.uniform1i(gl.getUniformLocation(prog, 'uField'), 0)
    gl.uniform2f(gl.getUniformLocation(prog, 'uRes'), cw, ch)
    gl.uniform1f(gl.getUniformLocation(prog, 'uPx'), scale)
    gl.uniform2f(gl.getUniformLocation(prog, 'uCam'), view.camX, view.camY)
    gl.uniform1f(gl.getUniformLocation(prog, 'uZoom'), view.zoom)
    gl.uniform2f(gl.getUniformLocation(prog, 'uFieldC'), f.cx, f.cy)
    gl.uniform1f(gl.getUniformLocation(prog, 'uHalf'), f.half)
    gl.uniform2f(gl.getUniformLocation(prog, 'uCore'), f.cx, f.cy)
    gl.uniform1f(gl.getUniformLocation(prog, 'uFade'), fade)
    gl.uniform1f(gl.getUniformLocation(prog, 'uTime'), t)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    gl.disable(gl.BLEND)
  }

  const drawStars = (now: number) => {
    const gl = starGl
    const prog = starProg
    if (!gl || !prog) return
    const cw = Math.max(1, Math.floor(w * dpr))
    const ch = Math.max(1, Math.floor(h * dpr))
    if (starCanvas.width !== cw || starCanvas.height !== ch) {
      starCanvas.width = cw
      starCanvas.height = ch
    }
    starCanvas.style.width = `${w}px`
    starCanvas.style.height = `${h}px`
    gl.viewport(0, 0, cw, ch)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.enable(gl.BLEND)
    // Additive: stars brighten whatever they sit on, which is how light behaves.
    gl.blendFunc(gl.ONE, gl.ONE)
    gl.useProgram(prog)
    gl.uniform2f(gl.getUniformLocation(prog, 'uRes'), cw, ch)
    gl.uniform1f(gl.getUniformLocation(prog, 'uTile'), TILE_CSS * dpr)
    gl.uniform1f(gl.getUniformLocation(prog, 'uTime'), time(now))
    gl.uniform1f(gl.getUniformLocation(prog, 'uDpr'), dpr)
    gl.uniform1f(gl.getUniformLocation(prog, 'uTwinkle'), reduced ? 0 : 0.35)

    for (const layer of layers) {
      bindStarAttributes(gl, prog, layer.buffer)
      gl.uniform2f(gl.getUniformLocation(prog, 'uOff'), view.camX * view.zoom * layer.parallax * dpr, view.camY * view.zoom * layer.parallax * dpr)
      gl.drawArrays(gl.POINTS, 0, layer.count)
    }

    // Galactic stars: world space, so they stay under the suns as the camera moves.
    const wprog = worldProg
    const fade = galaxyFade(view.zoom)
    if (wprog && worldBuf && worldCount > 0 && field && fade >= 0.01) {
      gl.useProgram(wprog)
      bindStarAttributes(gl, wprog, worldBuf)
      gl.uniform2f(gl.getUniformLocation(wprog, 'uRes'), cw, ch)
      gl.uniform2f(gl.getUniformLocation(wprog, 'uCam'), view.camX, view.camY)
      gl.uniform1f(gl.getUniformLocation(wprog, 'uZoom'), view.zoom)
      gl.uniform1f(gl.getUniformLocation(wprog, 'uDpr'), dpr)
      gl.uniform1f(gl.getUniformLocation(wprog, 'uTime'), time(now))
      gl.uniform1f(gl.getUniformLocation(wprog, 'uTwinkle'), reduced ? 0 : 0.35)
      gl.uniform1f(gl.getUniformLocation(wprog, 'uFade'), fade)
      gl.drawArrays(gl.POINTS, 0, worldCount)
    }
    gl.disable(gl.BLEND)
  }

  const draw = (now: number) => {
    if (destroyed) return
    if (nebulaDirty || now - lastNebula >= NEBULA_MS) {
      drawNebula(now)
      lastNebula = now
      nebulaDirty = false
    }
    drawStars(now)
  }

  const tick = (now: number) => {
    timer = 0
    if (destroyed) return
    draw(now)
    // Reduced motion draws only when the view changes; otherwise the sky animates at 30 fps.
    if (!reduced && !document.hidden) timer = window.setTimeout(() => requestAnimationFrame(tick), FRAME_MS)
  }

  const start = () => {
    if (timer || destroyed) return
    if (!reduced && !document.hidden) timer = window.setTimeout(() => requestAnimationFrame(tick), 0)
    else draw(performance.now())
  }

  const onVisibility = () => {
    if (document.hidden) {
      if (timer) window.clearTimeout(timer)
      timer = 0
      pausedAt = time(performance.now())
    } else {
      timeOffset = pausedAt - (performance.now() - t0) / 1000
      start()
    }
  }
  document.addEventListener('visibilitychange', onVisibility)

  const onLost = (e: Event) => {
    e.preventDefault()
    if (timer) window.clearTimeout(timer)
    timer = 0
  }
  const onRestored = () => {
    try {
      if (nebulaGl) initNebula(nebulaGl)
      if (starGl) initStars(starGl)
    } catch {
      destroy()
      return
    }
    start()
  }
  nebulaCanvas.addEventListener('webglcontextlost', onLost)
  starCanvas.addEventListener('webglcontextlost', onLost)
  nebulaCanvas.addEventListener('webglcontextrestored', onRestored)
  starCanvas.addEventListener('webglcontextrestored', onRestored)

  function destroy() {
    if (destroyed) return
    destroyed = true
    if (timer) window.clearTimeout(timer)
    timer = 0
    document.removeEventListener('visibilitychange', onVisibility)
    nebulaCanvas.removeEventListener('webglcontextlost', onLost)
    starCanvas.removeEventListener('webglcontextlost', onLost)
    nebulaCanvas.removeEventListener('webglcontextrestored', onRestored)
    starCanvas.removeEventListener('webglcontextrestored', onRestored)
    if (nebulaGl) {
      if (nebulaProg) nebulaGl.deleteProgram(nebulaProg)
      if (galaxyProg) nebulaGl.deleteProgram(galaxyProg)
      if (nebulaBuf) nebulaGl.deleteBuffer(nebulaBuf)
      if (fieldTex) nebulaGl.deleteTexture(fieldTex)
      nebulaGl.getExtension('WEBGL_lose_context')?.loseContext()
    }
    if (starGl) {
      if (starProg) starGl.deleteProgram(starProg)
      if (worldProg) starGl.deleteProgram(worldProg)
      if (worldBuf) starGl.deleteBuffer(worldBuf)
      for (const l of layers) starGl.deleteBuffer(l.buffer)
      starGl.getExtension('WEBGL_lose_context')?.loseContext()
    }
    nebulaProg = null
    galaxyProg = null
    nebulaBuf = null
    fieldTex = null
    starProg = null
    worldProg = null
    worldBuf = null
    layers = []
    nebulaCanvas.remove()
    starCanvas.remove()
  }

  start()

  return {
    resize(nw, nh, ndpr) {
      w = Math.max(1, nw)
      h = Math.max(1, nh)
      dpr = Math.max(1, ndpr)
      nebulaDirty = true
      if (!timer) draw(performance.now())
    },
    setView(v) {
      if (v.camX === view.camX && v.camY === view.camY && v.zoom === view.zoom) return
      view = v
      nebulaDirty = true
      // Reduced motion only redraws when the view moves; the animated loop covers the rest.
      if (reduced && !timer) draw(performance.now())
    },
    setField(f) {
      field = f
      if (nebulaGl) {
        if (fieldTex) nebulaGl.deleteTexture(fieldTex)
        fieldTex = null
        uploadField()
      }
      if (starGl) {
        if (worldBuf) starGl.deleteBuffer(worldBuf)
        worldBuf = null
        uploadWorld()
      }
      nebulaDirty = true
      if (reduced && !timer) draw(performance.now())
    },
    setReducedMotion(r) {
      reduced = r
      if (reduced) {
        if (timer) window.clearTimeout(timer)
        timer = 0
        pausedAt = time(performance.now())
        draw(performance.now())
      } else {
        timeOffset = pausedAt - (performance.now() - t0) / 1000
        start()
      }
    },
    destroy,
  }
}
