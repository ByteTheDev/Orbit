// The chat composer: a rounded input with its controls along the bottom, the branch chooser beneath
// it. Message state (drafts, queue, attachments, sending) lives in ChatTab; this component only lays
// it out and reports what the user does.
import { useEffect, useLayoutEffect, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from 'react'
import type { AgentSummary, BranchInfo } from '../../types'
import { setAgentBranch, setAgentEffort, setAgentModel, setAgentPermission, setAgentSpeed } from '../../lib/actions'
import { api } from '../../lib/bridge'
import { IMAGE_TYPES, MAX_IMAGES, type PendingImage } from '../../lib/chatImages'
import { effortName, effortTone } from '../../lib/effort'
import { Button, IconPlus, IconShield, IconStopCircle, IconX, MaterialIcon, ModelPicker, Select } from '../ui'
import { SpeedPicker, speedOf, speedOptionsFor } from '../ui/SpeedPicker'
import { IconSend } from './inspectorIcons'

/** The composer grows with its text up to this height, then scrolls. */
const MAX_TEXT_HEIGHT = 220

export interface ChatComposerProps {
  agent: AgentSummary
  draft: string
  onDraftChange: (value: string) => void
  onKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => void
  onPaste: (e: ClipboardEvent<HTMLTextAreaElement>) => void
  images: PendingImage[]
  onRemoveImage: (id: string) => void
  imageNote: string
  dragging: boolean
  onDragOver: (e: DragEvent<HTMLDivElement>) => void
  onDragLeave: () => void
  onDrop: (e: DragEvent<HTMLDivElement>) => void
  onPickFiles: (files: File[]) => void
  busy: boolean
  sending: boolean
  onSubmit: () => void
  onStop: () => void
  enterToSend: boolean
}

/**
 * The repository's local branches and the branch its project folder is on. Null when the project is
 * not a git repository with a commit. Reloads when the agent's branch changes.
 */
function useBranches(projectId: string, agentBranch: string | undefined): BranchInfo | null {
  const [info, setInfo] = useState<BranchInfo | null>(null)
  useEffect(() => {
    let alive = true
    setInfo(null)
    api
      .projectBranches(projectId)
      .then((i) => alive && setInfo(i))
      .catch(() => alive && setInfo(null))
    return () => {
      alive = false
    }
  }, [projectId, agentBranch])
  return info
}

export function ChatComposer(props: ChatComposerProps) {
  const { agent, draft, images, busy, sending } = props
  const caps = agent.capabilities
  const models = caps.models ?? []
  const selectedModel = models.find((m) => m.id === agent.model)
  const effortLevels = selectedModel?.effort ?? []
  // Max and Ultra get the same drifting border here as in the launch dialog.
  const effortOn = effortLevels.includes(agent.effort) ? agent.effort : ''
  const effortToneClass = effortTone(effortOn, agent.provider)
  // Fast mode shows wherever some model offers it, and is on only for a model that does.
  const fastOffered = models.some((m) => m.fastMode)
  const fastAvailable = selectedModel?.fastMode ?? false
  const fastOn = fastOffered && fastAvailable && agent.fastMode
  // Ultrafast is offered only on a model the signed-in account can run that way, and is on only then.
  const ultraAvailable = selectedModel?.ultraFast ?? false
  const ultraOn = ultraAvailable && agent.ultraFast
  const permissionModes = caps.permissionModes ?? []
  const branches = useBranches(agent.projectId, agent.branch)
  const currentBranch = agent.branch || branches?.current || ''
  const textRef = useRef<HTMLTextAreaElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [mentionStart, setMentionStart] = useState<number>(-1)
  const [mentionDir, setMentionDir] = useState<string>('')

  // Grow with the text. The height is reset first so the box can also shrink again.
  useLayoutEffect(() => {
    const el = textRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, MAX_TEXT_HEIGHT)}px`
    el.style.overflowY = el.scrollHeight > MAX_TEXT_HEIGHT ? 'auto' : 'hidden'
  }, [draft])

  const canSubmit = draft.trim() !== '' || images.length > 0

  const updateMentions = (value: string, cursor: number) => {
    const at = value.lastIndexOf('@', cursor - 1)
    if (at < 0 || (at > 0 && !/\\s/.test(value[at - 1]))) {
      setSuggestions([])
      setMentionStart(-1)
      return
    }
    const token = value.slice(at + 1, cursor)
    if (/\\s/.test(token)) {
      setSuggestions([])
      setMentionStart(-1)
      return
    }
    const slash = token.lastIndexOf('/')
    const dir = slash >= 0 ? token.slice(0, slash) : ''
    const prefix = slash >= 0 ? token.slice(slash + 1) : token
    setMentionStart(at)
    setMentionDir(dir)
    api
      .listProjectFiles(agent.projectId, dir)
      .then((names) => {
        const filtered = names.filter((n) => n.toLowerCase().startsWith(prefix.toLowerCase())).slice(0, 8)
        setSuggestions(filtered)
      })
      .catch(() => setSuggestions([]))
  }

  const chooseMention = (name: string) => {
    const el = textRef.current
    const cursor = el?.selectionStart ?? draft.length
    const full = mentionDir ? `${mentionDir}/${name}` : name
    const before = draft.slice(0, mentionStart)
    const after = draft.slice(cursor)
    const next = `${before}@${full} ${after}`
    props.onDraftChange(next)
    setSuggestions([])
    setMentionStart(-1)
    // restore cursor
    requestAnimationFrame(() => {
      if (textRef.current) {
        const pos = before.length + 1 + full.length + 1
        textRef.current.selectionStart = textRef.current.selectionEnd = pos
      }
    })
  }
  // While a reply runs, an empty composer shows Stop. Anything typed becomes a queued message.
  const showStop = busy && caps.stop && !canSubmit
  const hint = busy
    ? 'Sends when this reply finishes'
    : props.enterToSend
      ? 'Enter to send · Shift+Enter for a new line'
      : 'Ctrl+Enter to send · Enter for a new line'

  return (
    <div className="mx-auto w-full max-w-[52rem] @container">
      <div
        role="group"
        aria-label="Message composer"
        onDragOver={props.onDragOver}
        onDragLeave={props.onDragLeave}
        onDrop={props.onDrop}
        className={`rounded-[14px] border glass-inset transition-[border-color,box-shadow] duration-150 focus-within:border-tint/20 focus-within:ring-[3px] focus-within:ring-tint/[0.05] ${
          props.dragging ? 'border-tint/30 ring-[3px] ring-tint/[0.05]' : 'border-tint/[0.08] hover:border-tint/[0.14]'
        }`}
      >
        {images.length > 0 && (
          <ul aria-label="Attached images" className="flex flex-wrap gap-2 px-3 pb-1 pt-3">
            {images.map((img) => (
              <li key={img.id} className="relative">
                <img src={img.preview} alt={img.name} title={img.name} className="h-12 w-12 rounded-md border border-tint/[0.08] object-cover" />
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Remove ${img.name}`}
                  title="Remove"
                  onClick={() => props.onRemoveImage(img.id)}
                  className="absolute -right-1.5 -top-1.5 h-5 w-5 rounded-full border border-tint/[0.08] bg-canvas px-0"
                >
                  <IconX size={9} />
                </Button>
              </li>
            ))}
          </ul>
        )}
        {props.imageNote && (
          <p role="alert" className="px-3.5 pt-2 text-caption text-danger-soft">
            {props.imageNote}
          </p>
        )}

        <textarea
          ref={textRef}
          value={draft}
          onChange={(e) => {
            props.onDraftChange(e.target.value)
            updateMentions(e.target.value, e.target.selectionStart ?? e.target.value.length)
          }}
          onKeyDown={props.onKeyDown}
          onPaste={props.onPaste}
          aria-busy={sending}
          placeholder={busy ? `${agent.name} is working. Type to queue your next message.` : 'Ask, build, or describe a change...'}
          aria-label={`Message ${agent.name}`}
          rows={1}
          className="block max-h-[220px] min-h-[44px] w-full resize-none bg-transparent px-3.5 pb-1 pt-3 text-body leading-relaxed text-ink outline-none placeholder:text-faint"
        />

        {suggestions.length > 0 && (
          <ul className="mx-2 mb-1 max-h-40 overflow-auto rounded-md border border-tint/10 bg-canvas/95 p-1 text-sm">
            {suggestions.map((s) => (
              <li key={s}>
                <button
                  type="button"
                  className="block w-full rounded px-2 py-1 text-left text-ink hover:bg-tint/10"
                  onClick={() => chooseMention(s)}
                >
                  {s}
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 px-2 pb-2 pt-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => fileInput.current?.click()}
            disabled={sending || images.length >= MAX_IMAGES}
            aria-label="Attach images"
            title={images.length >= MAX_IMAGES ? `Up to ${MAX_IMAGES} images per message` : 'Attach images'}
            className="h-7 w-7 shrink-0 rounded-md px-0 text-muted"
          >
            <IconPlus size={14} />
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept={IMAGE_TYPES.join(',')}
            multiple
            hidden
            onChange={(e) => {
              props.onPickFiles(Array.from(e.target.files ?? []))
              e.target.value = ''
            }}
          />

          {models.length > 0 && (
            <div className="min-w-0 max-w-full">
              <ModelPicker
                compact
                value={agent.model}
                onChange={(next) => {
                  if (next !== agent.model) void setAgentModel(agent, next, models)
                }}
                models={models}
                provider={agent.provider}
                defaultLabel="Provider default"
                aria-label="Model for the next message"
              />
            </div>
          )}

          {effortLevels.length > 0 && (
            <div className="min-w-0 max-w-full">
              <Select
                compact
                id="chat-effort"
                aria-label="Thinking for the next message"
                className={effortToneClass}
                value={effortOn}
                onChange={(e) => {
                  if (e.target.value !== agent.effort) void setAgentEffort(agent, e.target.value)
                }}
              >
                <option value="">{selectedModel?.defaultEffort ? `${effortName(selectedModel.defaultEffort)} (default)` : 'Default'}</option>
                {effortLevels.map((level) => (
                  <option key={level} value={level}>
                    {effortName(level)}
                  </option>
                ))}
              </Select>
            </div>
          )}

          {fastOffered && (
            <div className="min-w-0 shrink-0">
              <SpeedPicker
                value={speedOf(fastOn, ultraOn)}
                options={speedOptionsFor(ultraAvailable)}
                disabled={!fastAvailable}
                title={fastAvailable ? 'Speed for the next message.' : 'Choose a model that supports fast mode.'}
                aria-label="Speed for the next message"
                onChange={(id) => {
                  const next = id === 'ultrafast' ? 'ultrafast' : id === 'fast' ? 'fast' : 'standard'
                  if (next !== speedOf(agent.fastMode, agent.ultraFast)) void setAgentSpeed(agent, next)
                }}
              />
            </div>
          )}

          {permissionModes.length > 0 && (
            <div className="flex min-w-0 max-w-full items-center text-faint">
              <IconShield size={12} className="ml-1 shrink-0" />
              <Select
                compact
                aria-label="Permissions for the next message"
                value={agent.permissionMode}
                onChange={(e) => {
                  if (e.target.value !== agent.permissionMode) void setAgentPermission(agent, e.target.value)
                }}
              >
                {permissionModes.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </Select>
            </div>
          )}

          {showStop ? (
            <Button
              variant="danger"
              size="sm"
              onClick={props.onStop}
              aria-label="Stop agent"
              title="Stop agent"
              className="ml-auto h-7 w-7 shrink-0 rounded-full px-0"
            >
              <IconStopCircle size={15} />
            </Button>
          ) : (
            <Button
              variant="primary"
              size="sm"
              onClick={props.onSubmit}
              disabled={!canSubmit || sending}
              aria-label={busy ? 'Queue message' : 'Send message'}
              title={busy ? 'Queue message' : 'Send'}
              className="ml-auto h-7 w-7 shrink-0 rounded-full px-0 transition-opacity duration-150 disabled:opacity-40"
            >
              <IconSend size={12} />
            </Button>
          )}
        </div>
      </div>

      <div className="mt-1.5 flex min-w-0 items-center justify-between gap-3 px-1 text-label text-faint">
        <span className="flex min-w-0 items-center gap-1.5 truncate">
          {branches && branches.branches.length > 0 && (
            <span className="flex min-w-0 shrink-0 items-center gap-1">
              <BranchGlyph />
              <Select
                compact
                aria-label="Branch for the next message"
                title={
                  agent.running
                    ? 'Wait for the reply to finish to change the branch.'
                    : 'Changing the branch starts a fresh session there. A branch that is not checked out in the project folder gets its own worktree.'
                }
                value={currentBranch}
                disabled={agent.running}
                onChange={(e) => {
                  if (e.target.value !== currentBranch) void setAgentBranch(agent, e.target.value)
                }}
                className="min-w-0 max-w-[14rem] truncate bg-transparent text-label text-muted outline-none hover:text-ink disabled:cursor-not-allowed disabled:opacity-60"
              >
                {branches.branches.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </Select>
            </span>
          )}
        </span>
        <span className="hidden shrink-0 @md:inline">{hint}</span>
      </div>
    </div>
  )
}

function BranchGlyph() {
  return <MaterialIcon name="call_split" size={11} />
}
