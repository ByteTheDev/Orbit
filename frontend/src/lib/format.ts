const rtf = typeof Intl !== 'undefined' ? new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }) : null

export function timeAgo(ms: number, now = Date.now()): string {
  if (!ms) return '—'
  const diff = (ms - now) / 1000
  const abs = Math.abs(diff)
  if (abs < 45) return 'just now'
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 31536000],
    ['month', 2592000],
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60],
  ]
  for (const [unit, secs] of units) {
    if (abs >= secs) {
      const v = Math.round(diff / secs)
      return rtf ? rtf.format(v, unit) : `${Math.abs(v)} ${unit}${Math.abs(v) === 1 ? '' : 's'} ago`
    }
  }
  return 'just now'
}

/** The letter drawn on a project's sun: the custom icon if set, otherwise the first letter of the name. */
export function projectMark(project: { name: string; icon?: string }): string {
  const custom = project.icon?.trim()
  if (custom) return custom
  const first = Array.from(project.name.trim())[0]
  return first ? first.toUpperCase() : '?'
}

export function clock(ms: number): string {
  if (!ms) return '—'
  return new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

export function elapsed(fromMs: number, now = Date.now()): string {
  if (!fromMs) return '—'
  const s = Math.max(0, Math.floor((now - fromMs) / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${sec.toString().padStart(2, '0')}s`
  return `${sec}s`
}

export function tokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

export function usd(n: number): string {
  if (n === 0) return '$0.00'
  if (n < 0.01) return `$${n.toFixed(4)}`
  return `$${n.toFixed(2)}`
}

export function baseName(path: string): string {
  const parts = path.split(/[\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? path
}

export function dirName(path: string): string {
  const parts = path.split(/[\/]/).filter(Boolean)
  return parts.slice(0, -1).join('/')
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}
