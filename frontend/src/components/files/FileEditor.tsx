import { useEffect, useMemo, useRef, useState } from 'react'
import { api, errorText } from '../../lib/bridge'
import { closeFileEditor, toast, useStore } from '../../lib/store'
import { highlightLines, languageFor } from '../../lib/highlight'
import { openEntry, revealEntry } from '../../lib/sourceActions'
import { baseName, dirName } from '../../lib/format'
import type { FileText } from '../../types'
import { Button, Dialog, Spinner } from '../ui'
import { OutlinedIcon } from '../ui/OutlinedIcon'
import { FileIcon } from '../ui/FileIcon'

/** Files this long are opened read-only in line view; editing a huge file in a textarea is not useful. */
const MAX_EDIT_LINES = 20000

/**
 * The file editor: a lightweight viewer with syntax colour, and an edit mode for text files. Saves are
 * checked against the file's modification time, so a save never silently overwrites an agent's
 * (or anyone's) newer change. Closing with unsaved edits asks first.
 */
export function FileEditor({ projectId, path }: { projectId: string; path: string }) {
  const [loaded, setLoaded] = useState<FileText | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [stale, setStale] = useState(false)
  const [confirmClose, setConfirmClose] = useState(false)
  const [confirmReload, setConfirmReload] = useState(false)
  const root = useStore((s) => s.projects[projectId]?.repoPath ?? '')
  const areaRef = useRef<HTMLTextAreaElement>(null)

  const load = () => {
    setError(null)
    setStale(false)
    setConfirmReload(false)
    api
      .readProjectText(projectId, path)
      .then((t) => {
        setLoaded(t)
        setDraft(t.content)
        setEditing(false)
      })
      .catch((err) => setError(errorText(err)))
  }

  useEffect(() => {
    setLoaded(null)
    load()
    // load reads only projectId and path, which the effect depends on.
  }, [projectId, path])

  const dirty = !!loaded && editing && draft !== loaded.content
  const canEdit = !!loaded && !loaded.binary && !loaded.tooLarge

  const lines = useMemo(() => (loaded && loaded.content ? loaded.content.split('\n') : []), [loaded])
  const lang = languageFor(path)
  const html = useMemo(() => {
    if (!loaded || loaded.binary || loaded.tooLarge || lines.length > MAX_EDIT_LINES) return null
    return highlightLines(loaded.content, lang)
  }, [loaded, lines, lang])

  const save = async () => {
    if (!loaded || saving) return
    setSaving(true)
    try {
      const mod = await api.writeProjectText(projectId, path, draft, loaded.modTime)
      setLoaded({ ...loaded, content: draft, modTime: mod, size: new TextEncoder().encode(draft).length })
      setEditing(false)
      toast(`Saved ${baseName(path)}.`, 'success')
    } catch (err) {
      const message = errorText(err)
      if (message.includes('changed on disk')) setStale(true)
      else toast(message, 'error')
    } finally {
      setSaving(false)
    }
  }

  const requestClose = () => {
    if (dirty) setConfirmClose(true)
    else closeFileEditor()
  }

  const onKey = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
      e.preventDefault()
      if (editing) void save()
    }
    if (e.key === 'Tab' && editing && areaRef.current === e.target) {
      // Insert two spaces instead of moving focus, so indentation works in the editor.
      e.preventDefault()
      const el = areaRef.current!
      const { selectionStart: s, selectionEnd: end } = el
      const next = draft.slice(0, s) + '  ' + draft.slice(end)
      setDraft(next)
      requestAnimationFrame(() => el.setSelectionRange(s + 2, s + 2))
    }
  }

  const footer = (
    <div className="flex w-full items-center gap-2">
      <Button size="sm" variant="ghost" onClick={() => void openEntry(projectId, path)} className="gap-1.5 text-caption text-muted">
        <OutlinedIcon name="open_in_new" size={13} />
        Open in default app
      </Button>
      <Button size="sm" variant="ghost" onClick={() => void revealEntry(projectId, path)} className="gap-1.5 text-caption text-muted">
        <OutlinedIcon name="folder_open" size={13} />
        Show in folder
      </Button>
      <span className="ml-auto flex items-center gap-2">
        {confirmClose ? (
          <>
            <span className="text-caption text-warn-soft">Discard unsaved edits?</span>
            <Button size="sm" variant="ghost" onClick={() => setConfirmClose(false)}>
              Keep editing
            </Button>
            <Button size="sm" variant="danger" onClick={closeFileEditor}>
              Discard
            </Button>
          </>
        ) : editing ? (
          <>
            <Button size="sm" variant="ghost" onClick={() => { setDraft(loaded?.content ?? ''); setEditing(false) }} disabled={saving}>
              Cancel
            </Button>
            <Button size="sm" variant="primary" onClick={() => void save()} disabled={saving || !dirty}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </>
        ) : (
          <>
            {canEdit && (
              <Button size="sm" variant="secondary" onClick={() => setEditing(true)} className="gap-1.5">
                <OutlinedIcon name="edit" size={13} />
                Edit
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={requestClose}>
              Close
            </Button>
          </>
        )}
      </span>
    </div>
  )

  return (
    <Dialog
      title={baseName(path)}
      description={`${dirName(path) ? dirName(path) + ' · ' : ''}${root ? 'in ' + root.split(/[\\/]/).pop() : ''}`}
      onClose={requestClose}
      width="max-w-4xl"
      footer={footer}
    >
      <div className="flex min-h-0 flex-col gap-3" onKeyDown={onKey}>
        <div className="flex items-center gap-2 text-label text-faint">
          <FileIcon path={path} size={14} />
          <span className="truncate font-mono">{path}</span>
          {loaded && <span className="ml-auto shrink-0 tabular-nums">{formatSize(loaded.size)}</span>}
        </div>

        {stale && (
          <div role="alert" className="flex items-center gap-3 rounded-md border border-warn/30 bg-warn/[0.06] px-3 py-2 text-caption text-warn-soft">
            <span className="min-w-0 flex-1">This file changed on disk after you opened it. Saving would overwrite that change.</span>
            {confirmReload ? (
              <>
                <Button size="sm" variant="ghost" onClick={() => setConfirmReload(false)}>
                  Keep my edits
                </Button>
                <Button size="sm" variant="danger" onClick={load}>
                  Reload and lose edits
                </Button>
              </>
            ) : (
              <Button size="sm" variant="secondary" onClick={() => setConfirmReload(true)}>
                Reload
              </Button>
            )}
          </div>
        )}

        {error && <p className="text-caption text-danger-soft">{error}</p>}
        {!loaded && !error && <Spinner label="Opening the file…" />}

        {loaded?.binary && <Notice icon="block" text="This is a binary file, so it cannot be shown as text. Open it in the app that made it." />}
        {loaded?.tooLarge && <Notice icon="data_object" text={`This file is ${formatSize(loaded.size)}, which is larger than the editor shows (1 MB). Open it in another app.`} />}

        {loaded && canEdit && editing && (
          <textarea
            ref={areaRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            spellCheck={false}
            aria-label={`Edit ${baseName(path)}`}
            className="h-[58vh] w-full resize-none rounded-md border border-line-strong bg-canvas p-3 font-mono text-label leading-[1.6] text-ink focus:outline-none"
            wrap="off"
          />
        )}

        {loaded && canEdit && !editing && html && (
          <div className="h-[58vh] overflow-auto rounded-md border border-line bg-canvas font-mono text-label leading-[1.6]">
            <table className="w-full border-collapse">
              <tbody>
                {html.map((line, i) => (
                  <tr key={i} className="align-top hover:bg-tint/[0.025]">
                    <td className="w-12 select-none whitespace-nowrap pr-3 text-right text-faint/70">{i + 1}</td>
                    <td className="whitespace-pre pr-4 text-ink/90" dangerouslySetInnerHTML={{ __html: line || '&#8203;' }} />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {loaded && canEdit && !editing && !html && (
          <p className="text-caption text-faint">This file has too many lines to colour. It is shown as plain text.</p>
        )}
      </div>
    </Dialog>
  )
}

function Notice({ icon, text }: { icon: string; text: string }) {
  return (
    <div className="flex items-start gap-3 rounded-md border border-line bg-tint/[0.02] px-4 py-6 text-caption text-muted">
      <OutlinedIcon name={icon} size={16} className="mt-px text-faint" />
      <span>{text}</span>
    </div>
  )
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
