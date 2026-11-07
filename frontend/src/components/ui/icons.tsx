import type { CSSProperties } from 'react'

/*
 * Orbit's UI icons are Google's Material Symbols (Rounded), installed locally from
 * @fontsource so they work offline. Each export keeps its old name, so call sites don't change.
 * Provider and brand marks (Claude, Codex, Pi, OMP, OpenCode, Orbit's logo) are not here.
 */

export interface IconProps {
  size?: number
  className?: string
  style?: CSSProperties
}

/** One Material Symbols glyph, by its ligature name (for example "add" or "settings"). */
export function MaterialIcon({ name, size = 16, className = '', style }: IconProps & { name: string }) {
  return (
    <span
      aria-hidden="true"
      className={`material-symbols-rounded ${className}`}
      style={{ width: size, height: size, fontSize: size, ...style }}
    >
      {name}
    </span>
  )
}

/**
 * The on/off knob of every switch: Google's toggle glyph, filled when on and outlined when off.
 * The parent button is the switch (role="switch"); this only draws its state.
 */
export function SwitchGlyph({ on, size = 36 }: { on: boolean; size?: number }) {
  return (
    <span
      aria-hidden="true"
      className={`material-symbols-rounded ${on ? 'text-ink' : 'text-faint'}`}
      style={{ fontSize: size, fontVariationSettings: on ? '"FILL" 1' : '"FILL" 0' }}
    >
      {on ? 'toggle_on' : 'toggle_off'}
    </span>
  )
}

const icon = (name: string) => (p: IconProps) => <MaterialIcon name={name} {...p} />

export const IconPlus = icon('add')
export const IconX = icon('close')
export const IconClock = icon('schedule')
export const IconGrid = icon('grid_view')
export const IconMinus = icon('remove')
export const IconFolder = icon('folder')
export const IconPlay = icon('play_arrow')
export const IconPencil = icon('edit')
export const IconCpu = icon('memory')
export const IconShield = icon('shield')
export const IconEye = icon('visibility')
export const IconUnlock = icon('lock_open')
export const IconText = icon('notes')
export const IconChevronDown = icon('expand_more')
export const IconCheck = icon('check')
export const IconSearch = icon('search')
export const IconKeyboard = icon('keyboard')
export const IconSettings = icon('settings')
export const IconFit = icon('fit_screen')
export const IconStop = icon('stop')
export const IconStopCircle = icon('stop_circle')
export const IconTrash = icon('delete')
export const IconInfo = icon('info')
export const IconChat = icon('chat')
export const IconFiles = icon('file_copy')
export const IconTarget = icon('target')
export const IconResume = icon('play_circle')
export const IconAlert = icon('warning')
export const IconSidebar = icon('left_panel_open')
export const IconInspect = icon('manage_search')
export const IconGlobe = icon('language')
export const IconMenu = icon('menu')
export const IconSliders = icon('tune')
