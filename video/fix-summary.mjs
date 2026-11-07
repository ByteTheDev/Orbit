return () => visual.column([
  visual.text('Video pass 2: mistakes fixed', {size: 'title'}),
  visual.stat('Render time', '~1 min', {detail: 'was 3 runs @ ~2 min (node, 6x concurrency)'}),
  visual.stat('Frame cost', 'Big drop', {detail: 'removed 3x animated 70-100px blurs, per-particle glow, animated grain'}),
  visual.table(['Issue','Fix'], [
    ['Starfield dead math + static y','Radial expansion from center'],
    ['GlitchText wrapped WordReveal flex','Plain-string glitch, sparse flashes'],
    ['Galaxy planets off-ring','Radius-relative orbits'],
    ['Washy light leak + scanlines','Subtle glow, scanlines removed'],
    ['Audio phase clicks','Integrated chirps + one-pole filters'],
  ]),
  visual.progress('Bun render', 100, {max: 100, detail: 'bunx + concurrency 12x, pinned versions'})
], {gap: 12});
