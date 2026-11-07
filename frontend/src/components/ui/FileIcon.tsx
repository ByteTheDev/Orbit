import { fileKindOf } from '../../lib/fileKind'

/**
 * A file's language or format from its name: the real logo when there is one, otherwise a small
 * coloured badge. Decorative: the name is always shown beside it.
 */
export function FileIcon({ path, size = 18 }: { path: string; size?: number }) {
  const kind = fileKindOf(path)
  if (kind.icon) {
    return (
      <img
        src={kind.icon}
        alt=""
        title={kind.id}
        width={size}
        height={size}
        draggable={false}
        className="shrink-0 select-none object-contain"
      />
    )
  }
  // Longer labels get smaller type so they still fit the badge.
  const fontSize = Math.round(size * (kind.label.length <= 2 ? 0.5 : kind.label.length === 3 ? 0.4 : 0.32))
  return (
    <span
      aria-hidden="true"
      title={kind.id === 'file' ? undefined : kind.id}
      className="inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded font-bold leading-none tracking-tight"
      style={{
        width: size,
        height: size,
        fontSize,
        background: kind.color,
        color: kind.light ? '#09090b' : '#ffffff',
      }}
    >
      {kind.label}
    </span>
  )
}
