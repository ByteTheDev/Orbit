import { MaterialIcon, type IconProps } from '../ui/icons'

/*
 * Icons used only by the inspector. Google Material Symbols, the same set as ui/icons.tsx.
 * They default to 14px here, the size the inspector uses.
 */

type Props = IconProps

const icon = (name: string) => (p: Props) => <MaterialIcon name={name} size={14} {...p} />

export const IconExpand = icon('open_in_full')
export const IconCollapse = icon('close_fullscreen')
export const IconMaximize = icon('fullscreen')
export const IconMinimize = icon('fullscreen_exit')
export const IconGalaxy = icon('hub')
export const IconChevronRight = icon('chevron_right')
export const IconChevronDown = icon('expand_more')
export const IconCopy = icon('content_copy')
export const IconLineNumbers = icon('format_list_numbered')
export const IconDiff = icon('difference')
export const IconSend = icon('send')
export const IconRetry = icon('refresh')
export const IconTool = icon('build')
export const IconFileRead = icon('file_open')
export const IconFileWrite = icon('edit_document')
export const IconTerminal = icon('terminal')
export const IconSearch = icon('search')
export const IconGlobe = icon('language')
export const IconPlug = icon('extension')
export const IconAgent = icon('smart_toy')
export const IconImage = icon('image')
export const IconBranch = icon('call_split')
export const IconCommit = icon('commit')
export const IconSpark = icon('auto_awesome')
