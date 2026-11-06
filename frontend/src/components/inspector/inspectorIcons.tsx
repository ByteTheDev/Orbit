import type { ReactNode, SVGProps } from 'react'

/*
 * Icons used only by the inspector. Same grid and stroke as ui/icons.tsx, kept here so the
 * shared icon set has a single owner.
 */

type Props = SVGProps<SVGSVGElement> & { size?: number }

function Svg({ size = 14, children, className = '', ...rest }: Props & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={`shrink-0 ${className}`}
      {...rest}
    >
      {children}
    </svg>
  )
}

export const IconChevronRight = (p: Props) => (
  <Svg {...p}>
    <path d="M9.5 6l6 6-6 6" />
  </Svg>
)

export const IconChevronDown = (p: Props) => (
  <Svg {...p}>
    <path d="M6 9.5l6 6 6-6" />
  </Svg>
)

export const IconCopy = (p: Props) => (
  <Svg {...p}>
    <rect x="8.5" y="8.5" width="11" height="11" rx="2" />
    <path d="M15.5 8.5V6.5a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2" />
  </Svg>
)

export const IconSend = (p: Props) => (
  <Svg {...p}>
    <path d="M4.5 12l15-7.5-5 15-2.5-6z" />
  </Svg>
)

export const IconRetry = (p: Props) => (
  <Svg {...p}>
    <path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3" />
    <path d="M4.5 4.5v4h4" />
  </Svg>
)

export const IconTool = (p: Props) => (
  <Svg {...p}>
    <path d="M14.5 6.5a4 4 0 0 0 4.9 4.9L11 19.8a2.1 2.1 0 0 1-3-3l8.4-8.3" />
    <path d="M14.5 6.5l2-2" />
  </Svg>
)

export const IconSpark = (p: Props) => (
  <Svg {...p}>
    <path d="M12 4v4M12 16v4M4 12h4M16 12h4M6.5 6.5l2.5 2.5M15 15l2.5 2.5M6.5 17.5L9 15M15 9l2.5-2.5" />
  </Svg>
)
