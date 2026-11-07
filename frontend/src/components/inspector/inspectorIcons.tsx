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

export const IconFileRead = (p: Props) => (
  <Svg {...p}>
    <path d="M14 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5z" />
    <path d="M14 3.5v5h5M9 13h6M9 16.5h4" />
  </Svg>
)

export const IconFileWrite = (p: Props) => (
  <Svg {...p}>
    <path d="M14 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5z" />
    <path d="M14 3.5v5h5M12 11.5v6M9 14.5h6" />
  </Svg>
)

export const IconTerminal = (p: Props) => (
  <Svg {...p}>
    <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
    <path d="M7.5 9.5l3 2.5-3 2.5M13 15h3.5" />
  </Svg>
)

export const IconSearch = (p: Props) => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="M16 16l4 4" />
  </Svg>
)

export const IconGlobe = (p: Props) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M3.5 12h17M12 3.5c2.3 2.4 3.4 5.2 3.4 8.5s-1.1 6.1-3.4 8.5c-2.3-2.4-3.4-5.2-3.4-8.5s1.1-6.1 3.4-8.5z" />
  </Svg>
)

export const IconPlug = (p: Props) => (
  <Svg {...p}>
    <path d="M9 3.5v4M15 3.5v4M7 7.5h10v3a5 5 0 0 1-10 0z" />
    <path d="M12 15.5v5" />
  </Svg>
)

export const IconAgent = (p: Props) => (
  <Svg {...p}>
    <rect x="5" y="8" width="14" height="11" rx="3" />
    <path d="M12 4.5V8M9.5 13h.01M14.5 13h.01M9.5 16.5h5" />
  </Svg>
)

export const IconImage = (p: Props) => (
  <Svg {...p}>
    <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
    <circle cx="9" cy="9.5" r="1.5" />
    <path d="M20.5 16l-4.5-4.5L7 19.5" />
  </Svg>
)

export const IconBranch = (p: Props) => (
  <Svg {...p}>
    <circle cx="6.5" cy="5.5" r="2" />
    <circle cx="6.5" cy="18.5" r="2" />
    <circle cx="17.5" cy="7.5" r="2" />
    <path d="M6.5 7.5v9M17.5 9.5c0 4-4 4.5-9 7" />
  </Svg>
)

export const IconCommit = (p: Props) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="3.5" />
    <path d="M3.5 12h5M15.5 12h5" />
  </Svg>
)

export const IconSpark = (p: Props) => (
  <Svg {...p}>
    <path d="M12 4v4M12 16v4M4 12h4M16 12h4M6.5 6.5l2.5 2.5M15 15l2.5 2.5M6.5 17.5L9 15M15 9l2.5-2.5" />
  </Svg>
)
