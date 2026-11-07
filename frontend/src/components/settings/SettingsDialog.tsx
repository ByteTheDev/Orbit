import { useState, type ReactNode } from 'react'
import { setSettings, useStore } from '../../lib/store'
import {
  ACCENTS,
  DEFAULT_SETTINGS,
  TEXT_SIZES,
  THEMES,
  type AccentId,
  type MotionSetting,
  type TextSize,
  type ThemeId,
  type ToastLength,
} from '../../lib/settings'
import { SHORTCUTS } from '../../lib/shortcuts'
import { APP_VERSION, releaseSummary, type ReleaseInfo } from '../../lib/release'
import { Button, Dialog, Kbd } from '../ui'

export type SectionId = 'appearance' | 'chat' | 'notifications' | 'keyboard' | 'release' | 'reset'

const SECTIONS: { id: SectionId; label: string }[] = [
  { id: 'appearance', label: 'Appearance' },
  { id: 'chat', label: 'Chat' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'keyboard', label: 'Keyboard' },
  { id: 'release', label: 'Release' },
  { id: 'reset', label: 'Reset' },
]

/** Settings page, opened from the top bar, with `,`, or with `?` (which opens the Keyboard section). Every control writes through setSettings at once. */
export function SettingsDialog({ onClose, section: initialSection = 'appearance' }: { onClose: () => void; section?: SectionId }) {
  const [section, setSection] = useState<SectionId>(initialSection)
  return (
    <Dialog
      title="Settings"
      description="Changes apply straight away and are saved on this computer."
      onClose={onClose}
      width="max-w-3xl"
    >
      <div className="grid gap-5 sm:grid-cols-[140px_minmax(0,1fr)]">
        <nav aria-label="Settings sections" className="flex gap-1 overflow-x-auto sm:flex-col sm:overflow-visible">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              aria-current={section === s.id ? 'page' : undefined}
              onClick={() => setSection(s.id)}
              className={`shrink-0 rounded-md px-2.5 py-1.5 text-left text-body transition-colors duration-150 ${
                section === s.id ? 'bg-white/[0.07] text-ink' : 'text-muted hover:bg-white/[0.04] hover:text-ink'
              }`}
            >
              {s.label}
            </button>
          ))}
        </nav>

        <div className="min-h-[340px] min-w-0">
          {section === 'appearance' && <AppearanceSection />}
          {section === 'chat' && <ChatSection />}
          {section === 'notifications' && <NotificationsSection />}
          {section === 'keyboard' && <KeyboardSection />}
          {section === 'release' && <ReleaseSection />}
          {section === 'reset' && <ResetSection />}
        </div>
      </div>
    </Dialog>
  )
}

// ---- sections ---------------------------------------------------------------------------

function AppearanceSection() {
  const settings = useStore((s) => s.settings)
  return (
    <div className="space-y-6">
      <Group title="Theme" hint="Changes the background and text colours. Status and agent colours stay the same, so they still read at a glance.">
        <div role="radiogroup" aria-label="Theme" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {THEMES.map((t) => {
            const selected = settings.theme === t.id
            const p = t.palette
            return (
              <button
                key={t.id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setSettings({ theme: t.id as ThemeId })}
                className={`group rounded-lg border p-2 text-left transition-colors duration-150 ${
                  selected ? 'border-line-strong bg-white/[0.05]' : 'border-line hover:border-line-strong hover:bg-white/[0.03]'
                }`}
              >
                <span
                  aria-hidden="true"
                  className="mb-2 flex h-14 overflow-hidden rounded-md border"
                  style={{ background: p.canvas, borderColor: p.border }}
                >
                  <span className="h-full w-1/4" style={{ background: p.sidebar, borderRight: `1px solid ${p.border}` }} />
                  <span className="flex flex-1 flex-col justify-center gap-1 px-2">
                    <span className="h-1.5 w-3/4 rounded-full" style={{ background: p.ink, opacity: 0.85 }} />
                    <span className="h-1.5 w-1/2 rounded-full" style={{ background: p.muted, opacity: 0.6 }} />
                    <span className="mt-1 h-3 w-full rounded-sm" style={{ background: p.surface, border: `1px solid ${p.border}` }} />
                  </span>
                </span>
                <span className="block text-body font-medium text-ink">{t.name}</span>
                <span className="block text-caption leading-snug text-faint">{t.blurb}</span>
              </button>
            )
          })}
        </div>
      </Group>

      <Group title="Accent" hint="Colours selection, focus rings and primary buttons. Neutral is the default.">
        <div role="radiogroup" aria-label="Accent colour" className="flex flex-wrap gap-2">
          {ACCENTS.map((a) => {
            const selected = settings.accent === a.id
            return (
              <button
                key={a.id}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-label={a.name}
                title={a.name}
                onClick={() => setSettings({ accent: a.id as AccentId })}
                className={`flex h-8 w-8 items-center justify-center rounded-full border transition-transform duration-150 hover:scale-105 ${
                  selected ? 'border-ink' : 'border-line-strong'
                }`}
              >
                <span className="h-5 w-5 rounded-full" style={{ background: a.color }} />
              </button>
            )
          })}
        </div>
      </Group>

      <Group title="Text size" hint="Scales the base text in the app. Some small labels keep their fixed size.">
        <Segmented<TextSize>
          label="Text size"
          value={settings.textSize}
          options={(Object.keys(TEXT_SIZES) as TextSize[]).map((id) => ({ id, label: TEXT_SIZES[id].label }))}
          onChange={(textSize) => setSettings({ textSize })}
        />
      </Group>

      <Group title="Motion" hint="Reduce motion stops the drifting galaxy and the sweeping activity lights. System follows your OS setting.">
        <Segmented<MotionSetting>
          label="Motion"
          value={settings.motion}
          options={[
            { id: 'system', label: 'System' },
            { id: 'reduce', label: 'Reduce' },
            { id: 'full', label: 'Full' },
          ]}
          onChange={(motion) => setSettings({ motion })}
        />
      </Group>
    </div>
  )
}

function ChatSection() {
  const settings = useStore((s) => s.settings)
  return (
    <div className="space-y-5">
      <Toggle
        label="Enter sends messages"
        hint={
          settings.enterToSend
            ? 'Enter sends. Shift+Enter starts a new line.'
            : 'Enter starts a new line. Ctrl+Enter (or ⌘+Enter) sends.'
        }
        checked={settings.enterToSend}
        onChange={(enterToSend) => setSettings({ enterToSend })}
      />
    </div>
  )
}

function NotificationsSection() {
  const settings = useStore((s) => s.settings)
  return (
    <div className="space-y-6">
      <Group title="Toast duration" hint="How long toasts stay on screen. Errors always stay for at least six seconds.">
        <Segmented<ToastLength>
          label="Toast length"
          value={settings.toastLength}
          options={[
            { id: 'short', label: 'Short' },
            { id: 'normal', label: 'Normal' },
            { id: 'long', label: 'Long' },
          ]}
          onChange={(toastLength) => setSettings({ toastLength })}
        />
      </Group>
    </div>
  )
}

function KeyboardSection() {
  const settings = useStore((s) => s.settings)
  return (
    <div className="space-y-6">
      <Toggle
        label="Single-key shortcuts"
        hint="N, P, D, F, 0, +, −, arrows, 1–6, [ ] and ? act without a modifier. Turn this off if you type a lot outside the chat box. Alt+↑ and Alt+↓ still work."
        checked={settings.singleKeyShortcuts}
        onChange={(singleKeyShortcuts) => setSettings({ singleKeyShortcuts })}
      />

      <Group title="Shortcut list" hint="Every keyboard shortcut in Orbit.">
        <ul className="divide-y divide-line rounded-lg border border-line">
          {SHORTCUTS.map((s) => (
            <li key={s.keys} className="flex items-center justify-between gap-4 px-3 py-2 text-body">
              <span className="text-ink/85">{s.action}</span>
              <span className="flex shrink-0 items-center gap-1">
                {s.keys.split(' ').filter((k) => k !== '+' && k !== '/' && k !== '–').map((k, i) => (
                  <Kbd key={`${k}-${i}`}>{k}</Kbd>
                ))}
              </span>
            </li>
          ))}
        </ul>
      </Group>
    </div>
  )
}

function ReleaseSection() {
  // The latest-release lookup is not wired to the backend yet, so there is no release to show.
  const latest: ReleaseInfo | null = null
  return (
    <div className="space-y-6">
      <Group title="Current version" hint="The version of Orbit you are running.">
        <p className="text-body text-ink/85">Orbit {APP_VERSION}</p>
      </Group>

      <Group title="Latest release" hint="Checked against published releases.">
        <p className="text-body text-muted">{releaseSummary(latest)}</p>
        <div>
          <Button variant="secondary" size="sm" disabled title="Available once the release backend is connected">
            Check for updates
          </Button>
        </div>
      </Group>
    </div>
  )
}

function ResetSection() {
  const [done, setDone] = useState(false)
  return (
    <div className="space-y-4">
      <Group title="Reset settings" hint="Puts every setting on this page back to its default. Your projects, agents and chats are not touched.">
        <div className="flex items-center gap-3">
          <Button
            variant="danger"
            onClick={() => {
              setSettings({ ...DEFAULT_SETTINGS })
              setDone(true)
            }}
          >
            Reset to defaults
          </Button>
          {done && <span role="status" className="text-body text-muted">Settings reset.</span>}
        </div>
      </Group>
    </div>
  )
}

// ---- building blocks ---------------------------------------------------------------------

function Group({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="space-y-2.5">
      <div>
        <h3 className="text-body font-medium text-ink">{title}</h3>
        {hint && <p className="mt-0.5 text-caption leading-snug text-faint">{hint}</p>}
      </div>
      {children}
    </section>
  )
}

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: { id: T; label: string }[]
  onChange: (value: T) => void
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex flex-wrap gap-1 rounded-lg border border-line bg-surface p-1">
      {options.map((o) => {
        const selected = o.id === value
        return (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(o.id)}
            className={`rounded-md px-3 py-1 text-body transition-colors duration-150 ${
              selected ? 'bg-ink text-canvas' : 'text-muted hover:text-ink'
            }`}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <div className="text-body font-medium text-ink" id={`toggle-${slug(label)}`}>
          {label}
        </div>
        {hint && <p className="mt-0.5 text-caption leading-snug text-faint">{hint}</p>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={`toggle-${slug(label)}`}
        onClick={() => onChange(!checked)}
        className={`relative mt-0.5 h-5 w-9 shrink-0 rounded-full border transition-colors duration-150 ${
          checked ? 'border-ink bg-ink' : 'border-line-strong bg-surface'
        }`}
      >
        <span
          className={`absolute top-0.5 h-3.5 w-3.5 rounded-full transition-transform duration-150 ${
            checked ? 'translate-x-[18px] bg-canvas' : 'translate-x-0.5 bg-muted'
          }`}
        />
      </button>
    </div>
  )
}

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-')
}
