import {
  Children,
  Fragment,
  forwardRef,
  isValidElement,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ChangeEvent,
  type InputHTMLAttributes,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react'
import { createPortal } from 'react-dom'
import type { ModelOption, Status } from '../../types'
import { DEFAULT_BODY, PROVIDER_BODY, STATUS_COLOR, STATUS_LABEL } from '../../lib/theme'
import { filterModels, groupModels } from '../../lib/modelSearch'
import { IconCheck, IconChevronDown, IconSearch, IconX } from './icons'

export * from './icons'

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
type ButtonSize = 'sm' | 'md'

/*
 * One button system for the whole app. Every variant shares the same radius, focus ring,
 * hover timing and press feedback, so a row of controls always reads as one family.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize }>(
  function Button({ variant = 'secondary', size = 'md', className = '', ...rest }, ref) {
    const base =
      'inline-flex items-center justify-center gap-1.5 rounded-md font-medium whitespace-nowrap select-none ' +
      'transition-[background-color,border-color,color,transform,opacity,box-shadow] duration-150 ease-out ' +
      'active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40 motion-reduce:transition-none motion-reduce:active:scale-100'
    const sizes: Record<ButtonSize, string> = { sm: 'h-7 px-2.5 text-caption', md: 'h-8 px-3 text-body' }
    const variants: Record<ButtonVariant, string> = {
      primary: 'bg-ink text-canvas shadow-sm shadow-black/30 hover:bg-tint [&_kbd]:border-black/10 [&_kbd]:bg-black/[0.06] [&_kbd]:text-canvas/70',
      secondary: 'border border-line bg-surface text-ink hover:border-line-strong hover:bg-hover',
      ghost: 'text-muted hover:bg-tint/[0.05] hover:text-ink',
      danger: 'border border-danger/25 bg-danger/10 text-danger-soft hover:border-danger/40 hover:bg-danger/15',
    }
    return <button ref={ref} className={`${base} ${sizes[size]} ${variants[variant]} ${className}`} {...rest} />
  },
)

/** One surface for everything that floats over the canvas: legend, zoom, hints, toasts. */
export const floatingSurface = 'border border-tint/[0.07] glass-popover shadow-float'

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-line bg-tint/[0.04] px-1.5 py-px font-mono text-label leading-4 text-faint">{children}</kbd>
}

export function StatusPill({ status, detail, compact = false }: { status: Status; detail?: string; compact?: boolean }) {
  const color = STATUS_COLOR[status]
  return (
    <span
      className="inline-flex max-w-full items-center gap-1.5 rounded-full border px-2 py-0.5 text-label font-medium"
      style={{ color, borderColor: `${color}33`, background: `${color}12` }}
      title={detail || STATUS_LABEL[status]}
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: color }} />
      <span className="shrink-0">{STATUS_LABEL[status]}</span>
      {!compact && detail && <span className="truncate font-normal opacity-70">· {detail}</span>}
    </span>
  )
}

/** A provider's planet as a small badge: the same body colour and mark used on the canvas. */
export function ProviderMark({ provider, size = 22 }: { provider: string; size?: number }) {
  const body = PROVIDER_BODY[provider] ?? DEFAULT_BODY
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-canvas shadow-inner shadow-black/20"
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.46),
        background: `radial-gradient(circle at 34% 30%, ${body.glow}, ${body.base} 62%, ${body.base}bb 100%)`,
        boxShadow: `0 0 ${Math.round(size * 0.6)}px -2px ${body.glow}55`,
      }}
      aria-hidden="true"
    >
      {body.logo ? (
        <img src={body.logo} alt="" width={Math.round(size * 0.6)} height={Math.round(size * 0.6)} draggable={false} className="block object-contain" />
      ) : (
        body.mark
      )}
    </span>
  )
}

type TagTone = 'neutral' | 'warn' | 'demo' | 'ok'

export function Tag({ children, tone = 'neutral' }: { children: ReactNode; tone?: TagTone }) {
  const tones: Record<TagTone, string> = {
    neutral: 'border-line bg-tint/[0.03] text-muted',
    warn: 'border-warn/30 bg-warn/10 text-warn-soft',
    demo: 'border-tint/10 border-dashed bg-transparent text-faint',
    ok: 'border-ok/30 bg-ok/10 text-ok',
  }
  return (
    <span className={`inline-flex items-center rounded border px-1.5 py-px text-label font-medium uppercase leading-4 tracking-[0.06em] ${tones[tone]}`}>
      {children}
    </span>
  )
}

export function Field({ label, hint, children, htmlFor, icon }: { label: string; hint?: string; children: ReactNode; htmlFor?: string; icon?: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={htmlFor} className="flex items-center gap-1.5 text-caption font-medium text-muted">
        {icon && <span className="text-faint">{icon}</span>}
        {label}
      </label>
      {children}
      {hint && <p className="text-label leading-relaxed text-faint">{hint}</p>}
    </div>
  )
}

/** A borderless trigger for controls that sit inside another surface, such as the chat composer. */
export const compactTrigger =
  'flex h-7 min-w-0 cursor-pointer items-center gap-1.5 rounded-md px-2 text-left text-label text-muted outline-none ' +
  'transition-colors duration-150 hover:bg-row-hover hover:text-ink focus-visible:ring-[3px] focus-visible:ring-tint/[0.08] ' +
  'aria-expanded:text-ink disabled:cursor-not-allowed disabled:opacity-50'

const fieldClass =
  'w-full rounded-md border border-line bg-surface px-2.5 text-body text-ink placeholder:text-faint ' +
  'outline-none transition-[border-color,box-shadow,background-color] duration-150 hover:border-line-strong ' +
  'focus:border-tint/30 focus:bg-canvas focus:ring-[3px] focus:ring-tint/[0.07] ' +
  'aria-invalid:border-danger/60 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-line'

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className = '', ...rest }, ref) {
  return <input ref={ref} className={`${fieldClass} h-8 ${className}`} {...rest} />
})

export function Textarea({ className = '', ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`${fieldClass} min-h-[84px] resize-y py-2 leading-relaxed ${className}`} {...rest} />
}

type SelectOption = { value: string; label: string; disabled: boolean; group?: string }
type OptionProps = { value?: string | number; disabled?: boolean; label?: string; children?: ReactNode }

function textOf(node: ReactNode): string {
  return Children.toArray(node)
    .map((c) => (typeof c === 'string' || typeof c === 'number' ? String(c) : ''))
    .join('')
}

/** Reads <option> and <optgroup> children, so callers keep the native markup. */
function readOptions(children: ReactNode, group?: string, out: SelectOption[] = []): SelectOption[] {
  Children.forEach(children, (child) => {
    if (!isValidElement<OptionProps>(child)) return
    if (child.type === 'optgroup') {
      readOptions(child.props.children, child.props.label, out)
    } else if (child.type === 'option') {
      const label = textOf(child.props.children)
      out.push({ value: String(child.props.value ?? label), label, disabled: !!child.props.disabled, group })
    }
  })
  return out
}

/** Next enabled index from `from` in direction `dir`, wrapping. Returns `from` if nothing is enabled. */
function stepEnabled(options: SelectOption[], from: number, dir: 1 | -1): number {
  const n = options.length
  let j = from < 0 ? (dir > 0 ? -1 : n) : from
  for (let k = 0; k < n; k++) {
    j = (j + dir + n) % n
    if (!options[j].disabled) return j
  }
  return from
}

/**
 * Custom dropdown with the same props as the native <select> it replaces: <option> children,
 * value, onChange(e) with e.target.value, and an id for its label. The list is a portal, so it
 * is never clipped by a scrolling dialog. Focus stays on the trigger (aria-activedescendant),
 * which keeps the dialog's focus trap working.
 */
/** The narrowest a Select's open list gets, so short labels such as "Low" still leave room for every option. */
const SELECT_MIN_LIST_WIDTH = 160

export function Select({
  id,
  value,
  onChange,
  disabled,
  children,
  className = '',
  compact = false,
  'aria-label': ariaLabel,
}: Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size' | 'multiple'> & { compact?: boolean }) {
  const options = useMemo(() => readOptions(children), [children])
  const current = String(value ?? '')
  const selectedIndex = options.findIndex((o) => o.value === current)
  const selected = selectedIndex >= 0 ? options[selectedIndex] : undefined

  const listId = useId()
  const optionId = (i: number) => `${listId}-${i}`
  const triggerRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const [pos, setPos] = useState<{ left: number; width: number; top?: number; bottom?: number } | null>(null)

  const openList = () => {
    if (disabled || options.length === 0) return
    const start = selectedIndex >= 0 && !options[selectedIndex].disabled ? selectedIndex : stepEnabled(options, -1, 1)
    setActive(start)
    setPos(null)
    setOpen(true)
  }

  const commit = (i: number) => {
    const option = options[i]
    if (!option || option.disabled) return
    // Shaped like a change event, so existing `e.target.value` handlers keep working.
    onChange?.({ target: { value: option.value } } as unknown as ChangeEvent<HTMLSelectElement>)
    setOpen(false)
    triggerRef.current?.focus()
  }

  // Place the list under the trigger, or above it when there is no room below.
  useLayoutEffect(() => {
    if (!open) return
    const trigger = triggerRef.current
    const list = listRef.current
    if (!trigger || !list) return
    const r = trigger.getBoundingClientRect()
    const below = window.innerHeight - r.bottom
    const flip = below < list.offsetHeight + 8 && r.top > below
    // A compact trigger shrinks to its label ("Low"), so the list is never narrower than SELECT_MIN_LIST_WIDTH.
    const width = Math.max(r.width, SELECT_MIN_LIST_WIDTH)
    const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8))
    setPos({ left, width, ...(flip ? { bottom: window.innerHeight - r.top + 4 } : { top: r.bottom + 4 }) })
  }, [open])

  // Keep the active option in view.
  useEffect(() => {
    if (!open || active < 0) return
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [open, active])

  // Close on any outside pointer, and when the page scrolls or resizes.
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node
      if (triggerRef.current?.contains(t) || listRef.current?.contains(t)) return
      setOpen(false)
    }
    const onScroll = (e: Event) => {
      if (listRef.current?.contains(e.target as Node)) return
      setOpen(false)
    }
    const onResize = () => setOpen(false)
    document.addEventListener('pointerdown', onDown, true)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onResize)
    return () => {
      document.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onResize)
    }
  }, [open])

  const onKeyDown = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        openList()
      }
      return
    }
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setActive((i) => stepEnabled(options, i, 1))
        break
      case 'ArrowUp':
        e.preventDefault()
        setActive((i) => stepEnabled(options, i, -1))
        break
      case 'Home':
        e.preventDefault()
        setActive(stepEnabled(options, -1, 1))
        break
      case 'End':
        e.preventDefault()
        setActive(stepEnabled(options, options.length, -1))
        break
      case 'Enter':
      case ' ':
        e.preventDefault()
        commit(active)
        break
      case 'Escape':
        e.preventDefault()
        e.stopPropagation()
        setOpen(false)
        break
      case 'Tab':
        setOpen(false)
        break
      default:
        // Type-ahead: jump to the next enabled option whose label starts with the typed character.
        if (e.key.length === 1) {
          const q = e.key.toLowerCase()
          const n = options.length
          for (let k = 1; k <= n; k++) {
            const j = (active + k + n) % n
            if (!options[j].disabled && options[j].label.toLowerCase().startsWith(q)) {
              setActive(j)
              break
            }
          }
        }
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && active >= 0 ? optionId(active) : undefined}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={onKeyDown}
        className={`${compact ? compactTrigger : `${fieldClass} flex h-8 cursor-pointer items-center justify-between gap-2 pl-2.5 pr-2 text-left disabled:cursor-not-allowed disabled:opacity-50`} ${className}`}
      >
        <span className="truncate">{selected?.label ?? ''}</span>
        <IconChevronDown size={14} className={`shrink-0 text-faint transition-transform duration-150 motion-reduce:transition-none ${open ? 'rotate-180' : ''}`} />
      </button>
      {open &&
        createPortal(
          <div
            ref={listRef}
            id={listId}
            role="listbox"
            data-listbox-open=""
            style={
              pos
                ? { left: pos.left, width: pos.width, top: pos.top, bottom: pos.bottom, transformOrigin: pos.bottom !== undefined ? 'bottom' : 'top' }
                : { left: 0, top: 0, visibility: 'hidden' }
            }
            className="fixed z-[60] max-h-72 overflow-y-auto rounded-lg border border-tint/[0.08] glass-popover p-1 shadow-popover animate-menu-in"
          >
            {options.map((o, i) => (
              <Fragment key={i}>
                {o.group && (i === 0 || options[i - 1].group !== o.group) && (
                  <div role="presentation" className="px-2 pb-1 pt-2 text-label font-medium text-faint">
                    {o.group}
                  </div>
                )}
                <div
                  id={optionId(i)}
                  role="option"
                  aria-selected={i === selectedIndex}
                  aria-disabled={o.disabled || undefined}
                  data-index={i}
                  onMouseMove={() => !o.disabled && i !== active && setActive(i)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => commit(i)}
                  className={`flex h-8 items-center justify-between gap-2 rounded-md px-2 text-body ${
                    o.disabled ? 'cursor-not-allowed text-faint opacity-50' : 'cursor-pointer text-ink'
                  } ${i === active ? 'bg-tint/[0.07]' : ''}`}
                >
                  <span className="truncate">{o.label}</span>
                  {i === selectedIndex && <IconCheck size={12} className="shrink-0 text-muted" />}
                </div>
              </Fragment>
            ))}
          </div>,
          document.body,
        )}
    </>
  )
}

type PickerPos = { left: number; width: number; top?: number; bottom?: number }

/**
 * Model chooser: a searchable, grouped list of one provider's models. The provider's own default
 * is the first row. Focus moves into the search box when it opens. Arrow keys move, Enter picks,
 * Escape or Tab closes. It only lists models the provider reports, and never invents one.
 */
export function ModelPicker({
  id,
  value,
  onChange,
  models,
  provider,
  defaultLabel,
  disabled,
  compact = false,
  'aria-label': ariaLabel,
}: {
  id?: string
  value: string
  onChange: (modelId: string) => void
  models: ModelOption[]
  provider: string
  defaultLabel: string
  disabled?: boolean
  compact?: boolean
  'aria-label'?: string
}) {
  const listId = useId()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [pos, setPos] = useState<PickerPos | null>(null)

  const selected = models.find((m) => m.id === value)
  const groups = useMemo(() => groupModels(filterModels(models, query)), [models, query])
  // The provider default is offered only when nothing is typed, so it never hides a search result.
  const rows = useMemo<(ModelOption | null)[]>(
    () => [...(query.trim() === '' ? [null] : []), ...groups.flatMap((g) => g.items)],
    [groups, query],
  )
  const matchCount = rows.length - (query.trim() === '' ? 1 : 0)

  const openList = () => {
    if (disabled) return
    setQuery('')
    const start = value ? [null, ...groupModels(models).flatMap((g) => g.items)].findIndex((m) => m?.id === value) : 0
    setActive(Math.max(0, start))
    setPos(null)
    setOpen(true)
  }

  const close = () => {
    setOpen(false)
    triggerRef.current?.focus()
  }

  const commit = (i: number) => {
    if (i < 0 || i >= rows.length) return
    onChange(rows[i]?.id ?? '')
    close()
  }

  // Focus the search box once the list is mounted.
  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  // Place the list under the trigger, or above it when there is no room below. The list aligns to the
  // trigger's right edge and stays inside the window, because the composer often sits near the right edge.
  useLayoutEffect(() => {
    if (!open) return
    const trigger = triggerRef.current
    const list = listRef.current
    if (!trigger || !list) return
    const r = trigger.getBoundingClientRect()
    const below = window.innerHeight - r.bottom
    const flip = below < list.offsetHeight + 8 && r.top > below
    const margin = 8
    const width = Math.min(Math.max(r.width, 280), window.innerWidth - margin * 2)
    const left = Math.max(margin, Math.min(r.right - width, window.innerWidth - margin - width))
    setPos({ left, width, ...(flip ? { bottom: window.innerHeight - r.top + 4 } : { top: r.bottom + 4 }) })
  }, [open])

  useEffect(() => {
    if (!open) return
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [open, active])

  // Close on an outside pointer, and when the page scrolls or resizes.
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node
      if (triggerRef.current?.contains(t) || listRef.current?.contains(t)) return
      setOpen(false)
    }
    const onScroll = (e: Event) => {
      if (listRef.current?.contains(e.target as Node)) return
      setOpen(false)
    }
    const onResize = () => setOpen(false)
    document.addEventListener('pointerdown', onDown, true)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onResize)
    return () => {
      document.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onResize)
    }
  }, [open])

  const onInputKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    const n = rows.length
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        if (n) setActive((i) => (i + 1) % n)
        break
      case 'ArrowUp':
        e.preventDefault()
        if (n) setActive((i) => (i - 1 + n) % n)
        break
      case 'Enter':
        e.preventDefault()
        commit(active)
        break
      case 'Escape':
        e.preventDefault()
        e.stopPropagation()
        close()
        break
      case 'Tab':
        setOpen(false)
        break
    }
  }

  let rowIndex = -1
  const rowId = (i: number) => `${listId}-${i}`

  return (
    <>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={(e) => {
          if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault()
            openList()
          }
        }}
        className={
          compact
            ? `${compactTrigger} max-w-full`
            : `${fieldClass} flex h-8 cursor-pointer items-center justify-between gap-2 pl-2.5 pr-2 text-left disabled:cursor-not-allowed disabled:opacity-50`
        }
      >
        <span className="flex min-w-0 items-center gap-2">
          <ProviderMark provider={provider} size={14} />
          <span className="truncate">{selected ? selected.label : defaultLabel}</span>
        </span>
        <IconChevronDown size={14} className={`shrink-0 text-faint transition-transform duration-150 motion-reduce:transition-none ${open ? 'rotate-180' : ''}`} />
      </button>
      {open &&
        createPortal(
          <div
            ref={listRef}
            data-listbox-open=""
            style={pos ? { left: pos.left, width: pos.width, top: pos.top, bottom: pos.bottom } : { left: 0, top: 0, visibility: 'hidden' }}
            className="fixed z-[60] flex max-h-96 flex-col overflow-hidden rounded-xl border border-tint/[0.08] glass-popover shadow-popover animate-fade-in"
          >
            <div className="flex items-center gap-2 border-b border-line px-3 py-2">
              <IconSearch size={13} className="shrink-0 text-faint" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value)
                  setActive(0)
                }}
                onKeyDown={onInputKeyDown}
                placeholder="Search models"
                aria-label="Search models"
                role="combobox"
                aria-expanded
                aria-controls={listId}
                aria-activedescendant={rows.length ? rowId(active) : undefined}
                autoComplete="off"
                spellCheck={false}
                className="min-w-0 flex-1 bg-transparent text-body text-ink placeholder:text-faint outline-none"
              />
            </div>
            <div id={listId} role="listbox" aria-label={`${provider} models`} className="min-h-0 flex-1 overflow-y-auto p-1">
              {rows.length === 0 && (
                <div className="px-3 py-6 text-center text-caption text-faint">
                  No models match “{query.trim()}”.
                </div>
              )}
              {query.trim() === '' && (
                <ModelRow
                  id={rowId(0)}
                  index={0}
                  active={active === 0}
                  selected={value === ''}
                  label={defaultLabel}
                  detail="Chosen by the provider"
                  onHover={() => setActive(0)}
                  onPick={() => commit(0)}
                />
              )}
              {groups.map((g) => (
                <div key={g.group} role="group" aria-label={g.group}>
                  <div role="presentation" className="px-2 pb-1 pt-2 text-label font-medium text-faint">
                    {g.group}
                  </div>
                  {g.items.map((m) => {
                    rowIndex += 1
                    const i = rowIndex + (query.trim() === '' ? 1 : 0)
                    return (
                      <ModelRow
                        key={m.id}
                        id={rowId(i)}
                        index={i}
                        active={active === i}
                        selected={m.id === value}
                        label={m.label}
                        detail={m.description}
                        onHover={() => setActive(i)}
                        onPick={() => commit(i)}
                      />
                    )
                  })}
                </div>
              ))}
            </div>
            {query.trim() !== '' && matchCount > 0 && (
              <div className="border-t border-line px-3 py-1.5 text-label tabular-nums text-faint">
                {matchCount} match{matchCount === 1 ? '' : 'es'}
              </div>
            )}
          </div>,
          document.body,
        )}
    </>
  )
}

function ModelRow({
  id,
  index,
  active,
  selected,
  label,
  detail,
  onHover,
  onPick,
}: {
  id: string
  index: number
  active: boolean
  selected: boolean
  label: string
  detail: string
  onHover: () => void
  onPick: () => void
}) {
  return (
    <div
      id={id}
      role="option"
      aria-selected={selected}
      data-index={index}
      onMouseMove={() => !active && onHover()}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onPick}
      className={`flex cursor-pointer items-center justify-between gap-3 rounded-md px-2 py-1.5 transition-colors duration-100 ${
        active ? 'bg-row-active' : ''
      }`}
    >
      <span className="min-w-0">
        <span className={`block truncate text-body leading-tight ${selected ? 'font-semibold text-ink' : 'font-medium text-ink/90'}`}>{label}</span>
        {detail && <span className="mt-0.5 block truncate text-label leading-snug text-faint">{detail}</span>}
      </span>
      {selected && <IconCheck size={12} className="shrink-0 text-muted" />}
    </div>
  )
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-muted" role="status">
      <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-tint/15 border-t-tint/70 motion-reduce:animate-none" />
      {label && <span className="text-caption">{label}</span>}
    </span>
  )
}

export function EmptyState({ title, body, action, icon }: { title: string; body: string; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex max-w-sm flex-col items-center text-center">
      {icon && <div className="mb-5 text-faint">{icon}</div>}
      <h2 className="text-title font-semibold tracking-[-0.01em] text-ink">{title}</h2>
      <p className="mt-1.5 text-body leading-relaxed text-muted">{body}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** Modal dialog. Escape closes it, Tab stays inside it, and focus returns to the element that opened it. */
export function Dialog({
  title,
  description,
  onClose,
  children,
  footer,
  width = 'max-w-lg',
}: {
  title: string
  description?: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  width?: string
}) {
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  // Read the latest close handler through a ref, so the effect below runs once
  // and does not steal focus back on every render.
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    const opener = document.activeElement
    const onKey = (e: KeyboardEvent) => {
      // An open dropdown owns Escape and Tab; it closes itself first.
      if (document.querySelector('[data-listbox-open]')) return
      if (e.key === 'Escape') {
        e.stopPropagation()
        closeRef.current()
        return
      }
      // Keep Tab inside the dialog so keyboard focus cannot wander into the page behind it.
      const panel = panelRef.current
      if (e.key !== 'Tab' || !panel) return
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE))
      if (items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement
      const outside = !(active instanceof Node) || !panel.contains(active)
      if (e.shiftKey && (outside || active === first)) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && (outside || active === last)) {
        e.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKey, true)
    panelRef.current?.querySelector<HTMLElement>('[data-autofocus], input, textarea, select')?.focus()
    return () => {
      window.removeEventListener('keydown', onKey, true)
      if (opener instanceof HTMLElement) opener.focus()
    }
  }, [])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
      <div className="dialog-scrim absolute inset-0 animate-fade-in bg-black/40 motion-reduce:animate-none" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`dialog-panel relative flex max-h-[86vh] w-full ${width} animate-dialog-in flex-col overflow-hidden rounded-xl border border-tint/[0.08] glass-popover shadow-popover motion-reduce:animate-none`}
      >
        <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-3.5">
          <div className="min-w-0">
            <h2 id={titleId} className="text-title font-semibold tracking-[-0.01em] text-ink">
              {title}
            </h2>
            {description && <p className="mt-0.5 text-caption leading-relaxed text-muted">{description}</p>}
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close dialog" className="-mr-1.5 h-7 w-7 shrink-0 rounded-md px-0">
            <IconX size={14} />
          </Button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <footer className="flex items-center justify-end gap-2 border-t border-line bg-canvas/40 px-5 py-3">{footer}</footer>}
      </div>
    </div>
  )
}
