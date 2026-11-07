/**
 * A Google Material Symbols glyph in the outlined style, for the Files and Git sidebars. The rest of the
 * app uses MaterialIcon (Rounded). Sizing and alignment match MaterialIcon, so the two sit side by side.
 */
export function OutlinedIcon({
  name,
  size = 16,
  filled = false,
  className = '',
}: {
  name: string
  size?: number
  filled?: boolean
  className?: string
}) {
  return (
    <span
      aria-hidden="true"
      className={`material-symbols-outlined ${className}`}
      style={{ width: size, height: size, fontSize: size, fontVariationSettings: `"FILL" ${filled ? 1 : 0}, "wght" 400, "GRAD" 0, "opsz" 24` }}
    >
      {name}
    </span>
  )
}
