/**
 * Maps a file name to a kind: a short label and a brand-style colour, so the file lists can show
 * one recognisable badge per language or format. Pure: no React, no Wails.
 *
 * Special names (Dockerfile, go.mod, .gitignore …) are checked before extensions, so the
 * extension rules never mislabel them. Anything unknown gets a neutral badge from its extension.
 */

export interface FileKind {
  /** Stable id, useful for tests and for future per-kind behaviour. */
  id: string
  /** Up to four characters, drawn on the badge. */
  label: string
  /** Badge fill. */
  color: string
  /** True for light fills, so the label is drawn dark. */
  light?: boolean
  /** URL of the real logo (PNG in src/assets/filetypes). Kinds without one show the label badge. */
  icon?: string
}

const KINDS: Record<string, FileKind> = {
  typescript: { id: 'typescript', label: 'TS', color: '#3178c6' },
  react: { id: 'react', label: 'Re', color: '#61dafb', light: true },
  javascript: { id: 'javascript', label: 'JS', color: '#f7df1e', light: true },
  go: { id: 'go', label: 'Go', color: '#00add8' },
  rust: { id: 'rust', label: 'Rs', color: '#ce422b' },
  python: { id: 'python', label: 'Py', color: '#3776ab' },
  java: { id: 'java', label: 'Jv', color: '#b07219' },
  kotlin: { id: 'kotlin', label: 'Kt', color: '#7f52ff' },
  swift: { id: 'swift', label: 'Sw', color: '#f05138' },
  c: { id: 'c', label: 'C', color: '#00599c' },
  cpp: { id: 'cpp', label: 'C++', color: '#f34b7d' },
  csharp: { id: 'csharp', label: 'C#', color: '#178600' },
  ruby: { id: 'ruby', label: 'Rb', color: '#cc342d' },
  php: { id: 'php', label: 'PHP', color: '#777bb4' },
  dart: { id: 'dart', label: 'Dt', color: '#0175c2' },
  lua: { id: 'lua', label: 'Lu', color: '#2c2d72' },
  scala: { id: 'scala', label: 'Sc', color: '#dc322f' },
  elixir: { id: 'elixir', label: 'Ex', color: '#6e4a7e' },
  haskell: { id: 'haskell', label: 'Hs', color: '#5e5086' },
  zig: { id: 'zig', label: 'Zg', color: '#ec915c', light: true },
  r: { id: 'r', label: 'R', color: '#276dc3' },
  perl: { id: 'perl', label: 'Pl', color: '#39457e' },
  shell: { id: 'shell', label: 'Sh', color: '#4eaa25' },
  powershell: { id: 'powershell', label: 'PS', color: '#2671be' },
  html: { id: 'html', label: '<>', color: '#e34c26' },
  css: { id: 'css', label: 'CSS', color: '#264de4' },
  sass: { id: 'sass', label: 'Sass', color: '#cc6699' },
  vue: { id: 'vue', label: 'Vue', color: '#41b883' },
  svelte: { id: 'svelte', label: 'Sv', color: '#ff3e00' },
  markdown: { id: 'markdown', label: 'MD', color: '#519aba' },
  json: { id: 'json', label: '{}', color: '#cbcb41', light: true },
  yaml: { id: 'yaml', label: 'YML', color: '#cb4b16' },
  toml: { id: 'toml', label: 'TOML', color: '#9c4221' },
  xml: { id: 'xml', label: 'XML', color: '#0060ac' },
  sql: { id: 'sql', label: 'SQL', color: '#e38c00', light: true },
  graphql: { id: 'graphql', label: 'GQL', color: '#e10098' },
  protobuf: { id: 'protobuf', label: 'Pb', color: '#6366f1' },
  terraform: { id: 'terraform', label: 'TF', color: '#7b42bc' },
  docker: { id: 'docker', label: 'Dk', color: '#2496ed' },
  make: { id: 'make', label: 'Mk', color: '#6d8086' },
  git: { id: 'git', label: 'Git', color: '#f05033' },
  config: { id: 'config', label: 'CFG', color: '#64748b' },
  lock: { id: 'lock', label: 'LCK', color: '#71717a' },
  image: { id: 'image', label: 'IMG', color: '#a855f7' },
  video: { id: 'video', label: 'VID', color: '#ec4899' },
  audio: { id: 'audio', label: 'AUD', color: '#f59e0b', light: true },
  archive: { id: 'archive', label: 'ZIP', color: '#a16207' },
  pdf: { id: 'pdf', label: 'PDF', color: '#dc2626' },
  text: { id: 'text', label: 'TXT', color: '#9ca3af', light: true },
  binary: { id: 'binary', label: 'BIN', color: '#475569' },
}

// Real logos, bundled as URLs. The file name under src/assets/filetypes is the kind id.
const ICON_URLS = import.meta.glob('../assets/filetypes/*.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>
for (const kind of Object.values(KINDS)) {
  kind.icon = ICON_URLS[`../assets/filetypes/${kind.id}.png`]
}

/** Extension (without the dot, lower case) → kind id. */
const BY_EXTENSION: Record<string, string> = {
  ts: 'typescript', mts: 'typescript', cts: 'typescript',
  tsx: 'react', jsx: 'react',
  js: 'javascript', mjs: 'javascript', cjs: 'javascript',
  go: 'go',
  rs: 'rust',
  py: 'python', pyw: 'python', pyi: 'python', ipynb: 'python',
  java: 'java',
  kt: 'kotlin', kts: 'kotlin',
  swift: 'swift',
  c: 'c', h: 'c',
  cc: 'cpp', cpp: 'cpp', cxx: 'cpp', hpp: 'cpp', hh: 'cpp', hxx: 'cpp',
  cs: 'csharp', csx: 'csharp',
  rb: 'ruby', erb: 'ruby', gemspec: 'ruby',
  php: 'php',
  dart: 'dart',
  lua: 'lua',
  scala: 'scala', sc: 'scala',
  ex: 'elixir', exs: 'elixir',
  hs: 'haskell', lhs: 'haskell',
  zig: 'zig',
  r: 'r', rmd: 'r',
  pl: 'perl', pm: 'perl',
  sh: 'shell', bash: 'shell', zsh: 'shell', fish: 'shell',
  ps1: 'powershell', psm1: 'powershell', psd1: 'powershell',
  html: 'html', htm: 'html', xhtml: 'html',
  css: 'css',
  scss: 'sass', sass: 'sass', less: 'css',
  vue: 'vue',
  svelte: 'svelte',
  md: 'markdown', mdx: 'markdown', markdown: 'markdown', rst: 'markdown',
  json: 'json', jsonc: 'json', json5: 'json', geojson: 'json',
  yml: 'yaml', yaml: 'yaml',
  toml: 'toml',
  xml: 'xml', xsd: 'xml', xsl: 'xml', xaml: 'xml', plist: 'xml', csproj: 'xml', props: 'xml',
  sql: 'sql', psql: 'sql',
  graphql: 'graphql', gql: 'graphql',
  proto: 'protobuf',
  tf: 'terraform', tfvars: 'terraform', hcl: 'terraform',
  dockerfile: 'docker',
  mk: 'make', make: 'make', cmake: 'make',
  ini: 'config', cfg: 'config', conf: 'config', env: 'config', properties: 'config', editorconfig: 'config', log: 'text',
  lock: 'lock',
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', bmp: 'image', ico: 'image', svg: 'image', tif: 'image', tiff: 'image', heic: 'image',
  mp4: 'video', mov: 'video', webm: 'video', mkv: 'video', avi: 'video',
  mp3: 'audio', wav: 'audio', flac: 'audio', ogg: 'audio', m4a: 'audio',
  zip: 'archive', tar: 'archive', gz: 'archive', tgz: 'archive', '7z': 'archive', rar: 'archive', xz: 'archive', bz2: 'archive',
  pdf: 'pdf',
  txt: 'text', text: 'text', rtf: 'text',
  exe: 'binary', dll: 'binary', so: 'binary', dylib: 'binary', bin: 'binary', wasm: 'binary', o: 'binary', a: 'binary', class: 'binary',
}

/** Whole file names (lower case) → kind id. Checked before extensions. */
const BY_NAME: Record<string, string> = {
  dockerfile: 'docker',
  'docker-compose.yml': 'docker', 'docker-compose.yaml': 'docker', 'compose.yml': 'docker', 'compose.yaml': 'docker',
  makefile: 'make', gnumakefile: 'make', justfile: 'make',
  'go.mod': 'go', 'go.sum': 'lock', 'go.work': 'go',
  'cargo.toml': 'rust', 'cargo.lock': 'lock',
  'package.json': 'json', 'package-lock.json': 'lock', 'yarn.lock': 'lock', 'pnpm-lock.yaml': 'lock', 'bun.lockb': 'lock',
  'composer.lock': 'lock', 'gemfile.lock': 'lock', 'poetry.lock': 'lock', 'pipfile.lock': 'lock', 'uv.lock': 'lock',
  'tsconfig.json': 'typescript',
  '.gitignore': 'git', '.gitattributes': 'git', '.gitmodules': 'git', '.gitkeep': 'git',
  '.npmrc': 'config', '.prettierrc': 'config', '.eslintrc': 'config', '.nvmrc': 'config', '.editorconfig': 'config',
  license: 'text', licence: 'text', notice: 'text', changelog: 'markdown', readme: 'markdown',
  'gemfile': 'ruby', 'rakefile': 'ruby', 'podfile': 'ruby',
  'requirements.txt': 'python', 'pyproject.toml': 'python',
}

const FALLBACK_COLOR = '#52525b'

/** Looks a key up in one of the tables above. Own keys only, so 'constructor' or 'toString' are not kinds. */
function lookup(table: Record<string, string>, key: string): FileKind | undefined {
  return Object.prototype.hasOwnProperty.call(table, key) ? KINDS[table[key]] : undefined
}

/** The kind for a path. Works on Windows and POSIX separators, and on a bare file name. */
export function fileKindOf(path: string): FileKind {
  const name = (path.split(/[\\/]/).filter(Boolean).pop() ?? '').toLowerCase()
  if (!name) return unknownKind('')

  const byName = lookup(BY_NAME, name)
  if (byName) return byName
  if (name.startsWith('dockerfile.') || name.startsWith('containerfile')) return KINDS.docker
  if (name === '.env' || name.startsWith('.env.')) return KINDS.config
  if (name.startsWith('tsconfig.') && name.endsWith('.json')) return KINDS.typescript

  const dot = name.lastIndexOf('.')
  if (dot <= 0) return unknownKind('')
  const ext = name.slice(dot + 1)
  const byExt = lookup(BY_EXTENSION, ext)
  if (byExt) return byExt
  return unknownKind(ext)
}

/** A neutral badge for anything unrecognised: the extension when there is one, else a dot. */
function unknownKind(ext: string): FileKind {
  const label = ext ? ext.slice(0, 3).toUpperCase() : '·'
  return { id: 'file', label, color: FALLBACK_COLOR }
}
