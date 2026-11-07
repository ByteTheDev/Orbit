import { useEffect, useRef, useState, type ReactNode } from 'react'
import { removeCustomTheme, setSettings, toast, useStore } from '../../lib/store'
import { api } from '../../lib/bridge'
import type { SSHProfile } from '../../types'
import {
  ACCENTS,
  DEFAULT_SETTINGS,
  SIDEBAR_OPACITY_RANGE,
  TEXT_SIZES,
  THEMES,
  THEME_FILE_EXAMPLE,
  type AccentId,
  type GlassBlur,
  type MotionSetting,
  type TextSize,
  type ThemeInfo,
  type ToastLength,
} from '../../lib/settings'
import { SHORTCUTS } from '../../lib/shortcuts'
import { approveTheme, checkForUpdates, openReleasePage, readThemeFile } from '../../lib/actions'
import { APP_VERSION, isNewer, releaseSummary } from '../../lib/release'
import { withDefaultModel } from '../../lib/defaultModel'
import { RISKY_PERMISSION_MODES, withDefaultPermission } from '../../lib/defaultPermission'
import type { ReleaseInfo } from '../../types'
import { Button, Dialog, Kbd, ModelPicker, ProviderMark, Select, SwitchGlyph } from '../ui'

export type SectionId = 'appearance' | 'glass' | 'models' | 'chat' | 'notifications' | 'keyboard' | 'ssh' | 'release' | 'reset'

const SECTIONS: { id: SectionId; label: string }[] = [
  { id: 'appearance', label: 'Appearance' },
  { id: 'glass', label: 'Liquid Glass' },
  { id: 'models', label: 'Models' },
  { id: 'chat', label: 'Chat' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'keyboard', label: 'Keyboard' },
  { id: 'ssh', label: 'SSH' },
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
                section === s.id ? 'bg-tint/[0.07] text-ink' : 'text-muted hover:bg-tint/[0.04] hover:text-ink'
              }`}
            >
              {s.label}
            </button>
          ))}
        </nav>

        <div className="min-h-[340px] min-w-0">
          {section === 'appearance' && <AppearanceSection />}
          {section === 'glass' && <GlassSection />}
          {section === 'models' && <ModelsSection />}
          {section === 'chat' && <ChatSection />}
          {section === 'notifications' && <NotificationsSection />}
          {section === 'keyboard' && <KeyboardSection />}
          {section === 'ssh' && <SSHSection />}
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
  const customThemes = useStore((s) => s.customThemes)
  const themes = [...THEMES, ...customThemes]
  return (
    <div className="space-y-6">
      <Group title="Theme" hint="Changes the background and text colours. Status and agent colours stay the same, so they still read at a glance.">
        <div role="radiogroup" aria-label="Theme" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {themes.map((t) => {
            const selected = settings.theme === t.id
            const p = t.palette
            return (
              <button
                key={t.id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setSettings({ theme: t.id })}
                className={`group rounded-lg border p-2 text-left transition-colors duration-150 ${
                  selected ? 'border-line-strong bg-tint/[0.05]' : 'border-line hover:border-line-strong hover:bg-tint/[0.03]'
                }`}
              >
                <ThemeSwatch palette={p} className="mb-2 h-14" />
                <span className="block text-body font-medium text-ink">{t.name}</span>
                <span className="block text-caption leading-snug text-faint">{t.blurb}</span>
              </button>
            )
          })}
        </div>
      </Group>

      <CustomThemes />

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

/**
 * Liquid Glass: translucent panels that float over the galaxy. Every control writes through
 * setSettings, which re-applies the variables at once, so the change shows before the page closes.
 */
function GlassSection() {
  const settings = useStore((s) => s.settings)
  const { min, max } = SIDEBAR_OPACITY_RANGE
  return (
    <div className="space-y-6">
      <Toggle
        label="Enable Liquid Glass"
        hint="Frosted, translucent panels. Off makes every surface solid."
        checked={settings.liquidGlass}
        onChange={(liquidGlass) => setSettings({ liquidGlass })}
      />

      <Group title="Sidebar opacity" hint={`How much of the galaxy shows through the project sidebar. Lower is more see-through; ${min}% is the least.`}>
        <div className="space-y-2">
          <div className="flex items-baseline justify-between text-body">
            <span className="text-muted">Opacity</span>
            <span className="tabular-nums text-ink">{settings.sidebarOpacity}%</span>
          </div>
          <input
            type="range"
            min={min}
            max={max}
            step={1}
            value={settings.sidebarOpacity}
            onChange={(e) => setSettings({ sidebarOpacity: Number(e.target.value) })}
            aria-label="Sidebar opacity"
            className="w-full accent-ink"
          />
        </div>
      </Group>

      <Group title="Blur" hint="How strongly glass panels blur whatever is behind them.">
        <Segmented<GlassBlur>
          label="Glass blur"
          value={settings.glassBlur}
          options={[
            { id: 'off', label: 'Off' },
            { id: 'subtle', label: 'Subtle' },
            { id: 'balanced', label: 'Balanced' },
            { id: 'strong', label: 'Strong' },
          ]}
          onChange={(glassBlur) => setSettings({ glassBlur })}
        />
      </Group>

      <Toggle
        label="Main pane glass"
        hint="Translucent glass for the agent workspace, the chat pane on the right."
        checked={settings.mainPaneGlass}
        onChange={(mainPaneGlass) => setSettings({ mainPaneGlass })}
      />
      <Toggle
        label="Glass on secondary surfaces"
        hint="Menus, pickers, dialogs, tooltips, cards, the composer and floating controls."
        checked={settings.secondaryGlass}
        onChange={(secondaryGlass) => setSettings({ secondaryGlass })}
      />
      <Toggle
        label="Reduce transparency"
        hint="Replaces translucent surfaces with solid ones and removes blur. Your OS setting for this is also respected."
        checked={settings.reduceTransparency}
        onChange={(reduceTransparency) => setSettings({ reduceTransparency })}
      />
    </div>
  )
}

/** One default model per provider. New agents start on it; the launch dialog can still change it for one agent. */
function ModelsSection() {
  const settings = useStore((s) => s.settings)
  const providers = useStore((s) => s.providers)
  return (
    <div className="space-y-6">
      <Group
        title="Default model"
        hint="The model a new agent starts with, for each provider. Provider default leaves the choice to the CLI. Only models the provider offers can be chosen."
      >
        <ul className="space-y-2.5" aria-label="Default model per provider">
          {providers.map((p) => {
            const models = p.capabilities.models ?? []
            return (
              <li key={p.id} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)] items-center gap-3">
                <span className="flex min-w-0 items-center gap-2">
                  <ProviderMark provider={p.id} size={16} />
                  <span className="truncate text-body text-ink">{p.name}</span>
                  {!p.available && <span className="shrink-0 text-label text-faint">Not installed</span>}
                </span>
                {models.length > 0 ? (
                  <ModelPicker
                    value={settings.defaultModels[p.id] ?? ''}
                    onChange={(model) => setSettings({ defaultModels: withDefaultModel(settings.defaultModels, p.id, model) })}
                    models={models}
                    provider={p.id}
                    defaultLabel="Provider default"
                    aria-label={`Default model for ${p.name}`}
                  />
                ) : (
                  <span className="text-caption text-faint">{p.name} picks its own model.</span>
                )}
              </li>
            )
          })}
        </ul>
      </Group>
      <Group
        title="Default permissions"
        hint="The access level a new agent starts with, for each provider. Provider default uses the first mode the provider lists. You can still change it for one agent at launch."
      >
        <ul className="space-y-2.5" aria-label="Default permissions per provider">
          {providers.map((p) => {
            const modes = p.capabilities.permissionModes ?? []
            const saved = settings.defaultPermissions[p.id] ?? ''
            const risky = RISKY_PERMISSION_MODES.has(saved)
            return (
              <li key={p.id} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)] items-start gap-3">
                <span className="flex min-w-0 items-center gap-2 pt-1.5">
                  <ProviderMark provider={p.id} size={16} />
                  <span className="truncate text-body text-ink">{p.name}</span>
                  {!p.available && <span className="shrink-0 text-label text-faint">Not installed</span>}
                </span>
                {modes.length > 0 ? (
                  <div className="min-w-0 space-y-1">
                    <Select
                      value={saved}
                      onChange={(e) =>
                        setSettings({ defaultPermissions: withDefaultPermission(settings.defaultPermissions, p.id, e.target.value) })
                      }
                      aria-label={`Default permissions for ${p.name}`}
                    >
                      <option value="">Provider default</option>
                      {modes.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.label}
                        </option>
                      ))}
                    </Select>
                    {risky && <p className="text-label text-warn-soft">New {p.name} agents act without asking. Pick a safer default if unsure.</p>}
                  </div>
                ) : (
                  <span className="pt-1.5 text-caption text-faint">{p.name} sets its own permissions.</span>
                )}
              </li>
            )
          })}
        </ul>
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
  const [checked, setChecked] = useState(false)
  const [latest, setLatest] = useState<ReleaseInfo | null>(null)
  const [busy, setBusy] = useState(false)
  const newer = latest !== null && isNewer(latest.version, APP_VERSION)

  const check = async () => {
    setBusy(true)
    const result = await checkForUpdates()
    setBusy(false)
    if (result) {
      setLatest(result.latest)
      setChecked(true)
    }
  }

  return (
    <div className="space-y-6">
      <Group title="Current version" hint="The version of Orbit you are running.">
        <p className="text-body text-ink/85">Orbit {APP_VERSION}</p>
      </Group>

      <Group title="Latest release" hint="Checked against published releases.">
        <p className="text-body text-muted">{checked ? releaseSummary(latest) : 'Not checked yet.'}</p>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" disabled={busy} onClick={() => void check()}>
            {busy ? 'Checking…' : 'Check for updates'}
          </Button>
          {latest && newer && (
            <Button size="sm" onClick={() => void openReleasePage(latest.url)}>
              Open release page
            </Button>
          )}
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

/** A small preview of a theme: canvas, sidebar, and a few text and surface tones. */
function ThemeSwatch({ palette: p, className }: { palette: ThemeInfo['palette']; className: string }) {
  return (
    <span aria-hidden="true" className={`flex overflow-hidden rounded-md border ${className}`} style={{ background: p.canvas, borderColor: p.border }}>
      <span className="h-full w-1/4" style={{ background: p.sidebar, borderRight: `1px solid ${p.border}` }} />
      <span className="flex flex-1 flex-col justify-center gap-1 px-2">
        <span className="h-1.5 w-3/4 rounded-full" style={{ background: p.ink, opacity: 0.85 }} />
        <span className="h-1.5 w-1/2 rounded-full" style={{ background: p.muted, opacity: 0.6 }} />
        <span className="mt-1 h-3 w-full rounded-sm" style={{ background: p.surface, border: `1px solid ${p.border}` }} />
      </span>
    </span>
  )
}

/** Upload a theme file, review it for approval, list the imported themes, and show the file format. */
function CustomThemes() {
  const customThemes = useStore((s) => s.customThemes)
  const selected = useStore((s) => s.settings.theme)
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  // A file that has been read but not yet approved. Nothing is saved until the user approves it.
  const [pending, setPending] = useState<ThemeInfo | null>(null)
  return (
    <Group title="Import a theme" hint="Upload a .json file with your own colours. Colours you leave out come from the base theme.">
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" disabled={busy || pending !== null} onClick={() => input.current?.click()}>
          Upload theme (.json)
        </Button>
        <input
          ref={input}
          type="file"
          accept=".json,application/json"
          className="hidden"
          aria-label="Theme file"
          onChange={async (e) => {
            const file = e.target.files?.[0]
            e.target.value = '' // so choosing the same file again still fires
            if (!file) return
            setBusy(true)
            try {
              setPending(await readThemeFile(file))
            } finally {
              setBusy(false)
            }
          }}
        />
        <span className="text-caption text-faint">{customThemes.length} imported</span>
      </div>

      {pending && (
        <div role="group" aria-label="Review theme" className="space-y-3 rounded-lg border border-line-strong bg-tint/[0.03] p-3">
          <div className="flex items-start gap-3">
            <ThemeSwatch palette={pending.palette} className="h-14 w-28 shrink-0" />
            <div className="min-w-0">
              <p className="text-body font-medium text-ink">Add “{pending.name}”?</p>
              <p className="text-caption leading-snug text-faint">{pending.blurb}</p>
              <p className="mt-1 text-caption text-faint">Approving saves the theme and switches to it.</p>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setPending(null)}>
              Deny
            </Button>
            <Button
              size="sm"
              variant="primary"
              onClick={() => {
                approveTheme(pending)
                setPending(null)
              }}
            >
              Approve
            </Button>
          </div>
        </div>
      )}

      {customThemes.length > 0 && (
        <ul className="space-y-1">
          {customThemes.map((t) => (
            <li key={t.id} className="flex items-center justify-between gap-2 rounded-md border border-line px-2.5 py-1.5">
              <span className="min-w-0 truncate text-body text-ink">
                {t.name}
                {selected === t.id && <span className="ml-2 text-caption text-faint">in use</span>}
              </span>
              <Button size="sm" variant="ghost" aria-label={`Remove ${t.name}`} onClick={() => removeCustomTheme(t.id)}>
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}

      <details className="text-caption text-faint">
        <summary className="cursor-pointer text-muted hover:text-ink">File format</summary>
        <pre className="mt-2 overflow-x-auto rounded-md border border-line bg-surface p-2 text-muted">{THEME_FILE_EXAMPLE}</pre>
        <p className="mt-2 leading-relaxed">
          Colours are #rgb, #rrggbb, #rrggbbaa or rgb(). Palette keys: canvas, sidebar, surface, popover, hover, border,
          line, lineStrong, ink, muted, faint. <code>base</code> can be any built-in theme id.
        </p>
      </details>
    </Group>
  )
}

function SSHSection() {
  const [profiles, setProfiles] = useState<SSHProfile[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<SSHProfile | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [draft, setDraft] = useState<SSHProfile>({
    id: '',
    name: '',
    host: '',
    port: 22,
    user: '',
    auth: 'key',
    keyPath: '',
    password: '',
    passphrase: '',
    createdAt: 0,
  })
  const [busy, setBusy] = useState(false)
  const [testResult, setTestResult] = useState<string | null>(null)

  const reload = async () => {
    setLoading(true)
    try {
      setProfiles(await api.listSSHProfiles())
    } catch (err) {
      toast((err as Error).message ?? 'Could not load SSH connections', 'error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void reload()
  }, [])

  const startNew = () => {
    setEditing(null)
    setDraft({ id: '', name: '', host: '', port: 22, user: '', auth: 'key', keyPath: '', password: '', passphrase: '', createdAt: 0 })
    setTestResult(null)
    setShowForm(true)
  }

  const startEdit = (p: SSHProfile) => {
    setEditing(p)
    setDraft({ ...p })
    setTestResult(null)
    setShowForm(true)
  }

  const save = async () => {
    setBusy(true)
    try {
      await api.saveSSHProfile(draft)
      toast('SSH connection saved', 'success')
      setEditing(null)
      setShowForm(false)
      await reload()
    } catch (err) {
      toast((err as Error).message ?? 'Could not save', 'error')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (id: string) => {
    setBusy(true)
    try {
      await api.deleteSSHProfile(id)
      toast('SSH connection removed')
      await reload()
    } catch (err) {
      toast((err as Error).message ?? 'Could not remove', 'error')
    } finally {
      setBusy(false)
    }
  }

  const test = async (id: string) => {
    setBusy(true)
    setTestResult(null)
    try {
      await api.testSSHProfile(id)
      setTestResult('Connected successfully.')
      toast('Connected successfully.', 'success')
    } catch (err) {
      const msg = (err as Error).message ?? 'Connection failed'
      setTestResult(msg)
      toast(msg, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-6">
      <Group title="Saved connections" hint="SSH hosts you can connect to from terminals and agents.">
        {loading ? (
          <p className="text-body text-muted">Loading…</p>
        ) : profiles.length === 0 ? (
          <p className="text-body text-muted">No SSH connections saved yet.</p>
        ) : (
          <ul className="space-y-2">
            {profiles.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 rounded-lg border border-line px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-body font-medium text-ink">{p.name}</p>
                  <p className="truncate text-caption text-faint">{p.user}@{p.host}:{p.port} ({p.auth})</p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button size="sm" variant="ghost" onClick={() => void test(p.id)} disabled={busy}>
                    Test
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => startEdit(p)} disabled={busy}>
                    Edit
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => void remove(p.id)} disabled={busy}>
                    Remove
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <Button size="sm" variant="secondary" onClick={startNew} disabled={busy}>
          New connection
        </Button>
      </Group>

      {showForm && (
        <Group title={editing ? 'Edit connection' : 'New connection'} hint="Fill in the host and how to authenticate.">
          <div className="space-y-3">
            <label className="block text-body text-ink">
              Name
              <input className="mt-1 w-full rounded-md border border-line bg-surface px-2 py-1.5 text-body text-ink" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </label>
            <label className="block text-body text-ink">
              Host
              <input className="mt-1 w-full rounded-md border border-line bg-surface px-2 py-1.5 text-body text-ink" value={draft.host} onChange={(e) => setDraft({ ...draft, host: e.target.value })} />
            </label>
            <label className="block text-body text-ink">
              Port
              <input type="number" className="mt-1 w-full rounded-md border border-line bg-surface px-2 py-1.5 text-body text-ink" value={draft.port} onChange={(e) => setDraft({ ...draft, port: Number(e.target.value) })} />
            </label>
            <label className="block text-body text-ink">
              User
              <input className="mt-1 w-full rounded-md border border-line bg-surface px-2 py-1.5 text-body text-ink" value={draft.user} onChange={(e) => setDraft({ ...draft, user: e.target.value })} />
            </label>
            <div className="block text-body text-ink">
              Authentication
              <Select className="mt-1 w-full" value={draft.auth} onChange={(e) => setDraft({ ...draft, auth: e.target.value as SSHProfile['auth'] })}>
                <option value="key">Private key</option>
                <option value="password">Password</option>
                <option value="agent">SSH agent</option>
              </Select>
            </div>
            {draft.auth === 'key' && (
              <>
                <label className="block text-body text-ink">
                  Private key path
                  <input className="mt-1 w-full rounded-md border border-line bg-surface px-2 py-1.5 text-body text-ink" value={draft.keyPath ?? ''} onChange={(e) => setDraft({ ...draft, keyPath: e.target.value })} />
                </label>
                <label className="block text-body text-ink">
                  Passphrase (optional)
                  <input type="password" className="mt-1 w-full rounded-md border border-line bg-surface px-2 py-1.5 text-body text-ink" value={draft.passphrase ?? ''} onChange={(e) => setDraft({ ...draft, passphrase: e.target.value })} />
                </label>
              </>
            )}
            {draft.auth === 'password' && (
              <label className="block text-body text-ink">
                Password
                <input type="password" className="mt-1 w-full rounded-md border border-line bg-surface px-2 py-1.5 text-body text-ink" value={draft.password ?? ''} onChange={(e) => setDraft({ ...draft, password: e.target.value })} />
              </label>
            )}
            {testResult && <p className="text-caption text-muted">{testResult}</p>}
            <div className="flex gap-2">
              <Button size="sm" variant="primary" disabled={busy} onClick={() => void save()}>
                {busy ? 'Saving…' : 'Save'}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => { setEditing(null); setShowForm(false); setDraft({ id: '', name: '', host: '', port: 22, user: '', auth: 'key', keyPath: '', password: '', passphrase: '', createdAt: 0 }) }}>
                Cancel
              </Button>
            </div>
          </div>
        </Group>
      )}
    </div>
  )
}

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
        className="mt-0.5 shrink-0 rounded-md outline-none transition-opacity duration-150 hover:opacity-80"
      >
        <SwitchGlyph on={checked} />
      </button>
    </div>
  )
}

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-')
}
