import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent, type ReactNode } from 'react'
import type { AgentSummary, Attachment, Handoff, Message, ToolCall } from '../../types'
import { attachmentImage, loadDetail, resumeAgent, sendMessage, stopAgent } from '../../lib/actions'
import { addImages, toUploads, type PendingImage } from '../../lib/chatImages'
import { clock, duration } from '../../lib/format'
import { takeMentions, toast, useStore } from '../../lib/store'
import { STATUS_COLOR } from '../../lib/theme'
import { editPreview } from '../../lib/toolEdit'
import { toolKind, type ToolKind } from '../../lib/toolKind'
import { Button, IconCheck, IconPencil, IconPlay, IconX, ProviderMark } from '../ui'
import { ChatComposer, type SlashCommand } from './ChatComposer'
import { CopyButton, Markdownish, copyText } from './ChatMarkdown'
import { TalkShowcase } from './TalkShowcase'
import { ToolDiff } from './ToolDiff'
import {
  IconAgent,
  IconChevronDown,
  IconChevronRight,
  IconCopy,
  IconFileRead,
  IconFileWrite,
  IconGlobe,
  IconPlug,
  IconRetry,
  IconSearch,
  IconTerminal,
  IconTool,
} from './inspectorIcons'

/** Messages and tool calls are shown this many at a time; older ones load on request. */
const PAGE = 120

/**
 * Unsent drafts, keyed by agent. They survive switching agents and closing the inspector,
 * so a half-written message is never lost to navigation.
 */
const drafts = new Map<string, string>()

/** Unsent images, keyed by agent, kept alongside the draft text. */
const imageDrafts = new Map<string, PendingImage[]>()

/** A message typed while the agent was working, with the images attached to it. */
interface QueuedMessage {
  text: string
  images: PendingImage[]
}

/**
 * Messages typed while the agent was working. They are sent one at a time when each reply
 * finishes. Kept per agent, so they survive switching tabs.
 */
const queues = new Map<string, QueuedMessage[]>()

interface Props {
  agent: AgentSummary
  messages?: Message[]
  tools?: ToolCall[]
  loaded: boolean
  /** Set when the history could not be loaded. Shown in place of the conversation. */
  error?: string
}

type TimelineItem =
  | { key: string; at: number; kind: 'message'; message: Message }
  | { key: string; at: number; kind: 'tool'; tool: ToolCall }
  | { key: string; at: number; kind: 'handoff'; handoff: Handoff }

/**
 * Adds the handoffs that touch this agent at the point they happened. Handoffs arrive
 * separately from messages and tools, so this is one more ordered merge.
 */
function mergeHandoffs(items: TimelineItem[], handoffs: Handoff[]): TimelineItem[] {
  if (handoffs.length === 0) return items
  const sorted = [...handoffs].sort((a, b) => a.at - b.at)
  const out: TimelineItem[] = []
  let j = 0
  for (const item of items) {
    while (j < sorted.length && sorted[j].at < item.at) {
      const h = sorted[j++]
      out.push({ key: `h:${h.id}`, at: h.at, kind: 'handoff', handoff: h })
    }
    out.push(item)
  }
  for (; j < sorted.length; j++) {
    const h = sorted[j]
    out.push({ key: `h:${h.id}`, at: h.at, kind: 'handoff', handoff: h })
  }
  return out
}

/**
 * Interleaves replies and tool calls in the order they happened. Both inputs arrive in
 * time order, so a single merge pass is enough.
 */
function mergeTimeline(messages: Message[], tools: ToolCall[]): TimelineItem[] {
  const out: TimelineItem[] = []
  let i = 0
  let j = 0
  while (i < messages.length || j < tools.length) {
    const m = messages[i]
    const t = tools[j]
    if (m && (!t || (m.at || 0) <= (t.at || 0))) {
      out.push({ key: `m:${m.id}`, at: m.at || 0, kind: 'message', message: m })
      i++
    } else {
      out.push({ key: `t:${t.id}`, at: t.at || 0, kind: 'tool', tool: t })
      j++
    }
  }
  return out
}

export function ChatTab({ agent, messages, tools, loaded, error }: Props) {
  const [draft, setDraft] = useState(() => drafts.get(agent.id) ?? '')
  const draftRef = useRef(draft)
  // Files attached from the Files sidebar join the draft as @mentions, the form the composer inserts.
  const pendingMentions = useStore((s) => s.pendingMentions[agent.id])
  useEffect(() => {
    if (!pendingMentions?.length) return
    const text = pendingMentions.map((p) => `@${p}`).join(' ')
    const current = draftRef.current
    updateDraft(current && !/s$/.test(current) ? `${current} ${text} ` : `${current}${text} `)
    takeMentions(agent.id)
    // updateDraft reads only refs and setters, so the attachments alone drive this effect.
  }, [pendingMentions])
  const [sending, setSending] = useState(false)
  const [queue, setQueue] = useState<QueuedMessage[]>(() => queues.get(agent.id) ?? [])
  const queueRef = useRef(queue)
  const [images, setImages] = useState<PendingImage[]>(() => imageDrafts.get(agent.id) ?? [])
  const imagesRef = useRef(images)
  // Why the last attach attempt was refused, shown under the composer.
  const [imageNote, setImageNote] = useState('')
  const [dragging, setDragging] = useState(false)
  // Set by Stop: a stopped reply should not send the messages queued behind it.
  const stoppedRef = useRef(false)
  const [limit, setLimit] = useState(PAGE)
  const scrollRef = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)
  // Whether the view is at the newest message. Drives the "Latest" control; set only when it changes.
  const [atBottom, setAtBottom] = useState(true)
  // Set just before older messages load, so the same message stays in place instead of jumping.
  const prependAnchor = useRef<{ height: number; top: number } | null>(null)

  // Handoffs live on the project. Only the ones this agent sent or received belong in its conversation.
  const projectHandoffs = useStore((s) => s.projects[agent.projectId]?.handoffs)
  const handoffs = useMemo(
    () => (projectHandoffs ?? []).filter((h) => h.fromId === agent.id || h.toId === agent.id),
    [projectHandoffs, agent.id],
  )
  const timeline = useMemo(
    () => mergeHandoffs(mergeTimeline(messages ?? [], tools ?? []), handoffs),
    [messages, tools, handoffs],
  )
  const shown = timeline.length > limit ? timeline.slice(timeline.length - limit) : timeline
  const hidden = timeline.length - shown.length
  const last = timeline[timeline.length - 1]
  // Changes whenever the newest item grows, so streamed text keeps the view pinned to the bottom.
  const lastSignature = last
    ? last.kind === 'message'
      ? `${last.key}:${last.message.text.length}`
      : last.kind === 'tool'
        ? `${last.key}:${last.tool.status}`
        : last.key
    : ''
  const busy = agent.running
  const caps = agent.capabilities
  const awaitingReply = busy && last?.kind === 'message' && last.message.role === 'user'

  // The newest reply, and the plain-text prompt that produced it. Drives Retry and the /copy command.
  const lastReply = useMemo(() => {
    for (let i = timeline.length - 1; i >= 0; i--) {
      const item = timeline[i]
      if (item.kind !== 'message' || item.message.role !== 'assistant') continue
      let prompt = ''
      for (let j = i - 1; j >= 0; j--) {
        const before = timeline[j]
        if (before.kind === 'message' && before.message.role === 'user') {
          // A prompt with images cannot be replayed as text alone, so Retry is withheld for it.
          prompt = before.message.attachments?.length ? '' : before.message.text
          break
        }
      }
      return { key: item.key, text: item.message.text, prompt }
    }
    return null
  }, [timeline])
  // Retry belongs only to the newest reply, and only once the agent is idle.
  const retryKey = !busy && last?.kind === 'message' && last.message.role === 'assistant' && lastReply?.prompt ? lastReply.key : null

  const retryPrompt = async () => {
    const text = lastReply?.prompt
    if (!text || busy || sending) return
    stoppedRef.current = false
    pinned.current = true
    setSending(true)
    await sendMessage(agent.id, text)
    setSending(false)
  }

  // Slash commands run an action instead of sending text. Only the ones that apply now are offered.
  const commands: SlashCommand[] = [
    { name: 'stop', description: 'Stop the reply in progress', available: busy && caps.stop, run: () => void stopAgent(agent.id) },
    {
      name: 'continue',
      description: 'Continue where the agent stopped',
      available: !busy && caps.resume && agent.turns > 0,
      run: () => void resumeAgent(agent.id),
    },
    {
      name: 'copy',
      description: 'Copy the latest reply',
      available: !!lastReply?.text,
      run: () => {
        if (lastReply?.text) void copyText(lastReply.text).then((ok) => toast(ok ? 'Copied the reply' : 'Could not copy to the clipboard', ok ? 'success' : 'error'))
      },
    },
  ]
  const availableCommands = commands.filter((c) => c.available)
  const runCommand = (name: string) => {
    const cmd = commands.find((c) => c.name === name && c.available)
    if (!cmd) return
    updateDraft('')
    cmd.run()
  }

  const setQueueFor = (next: QueuedMessage[]) => {
    queueRef.current = next
    setQueue(next)
    if (next.length) queues.set(agent.id, next)
    else queues.delete(agent.id)
  }

  const setImagesFor = (next: PendingImage[]) => {
    imagesRef.current = next
    setImages(next)
    if (next.length) imageDrafts.set(agent.id, next)
    else imageDrafts.delete(agent.id)
  }

  // When a turn ends, send the next queued message. Acting only on the busy -> idle edge stops
  // two queued messages from racing into one turn, which the backend would reject as busy.
  const wasBusy = useRef(busy)
  useEffect(() => {
    const was = wasBusy.current
    wasBusy.current = busy
    if (!was || busy) return
    if (stoppedRef.current) {
      stoppedRef.current = false
      setQueueFor([])
      return
    }
    const [next, ...rest] = queueRef.current
    if (next === undefined) return
    setQueueFor(rest)
    // The user may have scrolled up while the reply streamed. Pin to the bottom so the sent message is visible.
    pinned.current = true
    setSending(true)
    void sendMessage(agent.id, next.text, toUploads(next.images)).then((ok) => {
      setSending(false)
      // Put a failed message back in the composer so it is not lost.
      if (!ok && !draftRef.current.trim() && imagesRef.current.length === 0) {
        updateDraft(next.text)
        setImagesFor(next.images)
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only the busy edge should trigger a send.
  }, [busy])

  const onStop = () => {
    stoppedRef.current = true
    void stopAgent(agent.id)
  }

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const anchor = prependAnchor.current
    if (anchor) {
      // Older messages were added above what the reader sees: move down by exactly the height they added.
      prependAnchor.current = null
      el.scrollTop = anchor.top + (el.scrollHeight - anchor.height)
      return
    }
    if (pinned.current) el.scrollTop = el.scrollHeight
  }, [shown.length, lastSignature, limit])

  const onScroll = () => {
    const el = scrollRef.current
    if (!el) return
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 48
    pinned.current = near
    setAtBottom((was) => (was === near ? was : near))
  }

  const jumpToLatest = () => {
    const el = scrollRef.current
    pinned.current = true
    setAtBottom(true)
    if (el) el.scrollTop = el.scrollHeight
  }

  const loadEarlier = () => {
    const el = scrollRef.current
    if (el) prependAnchor.current = { height: el.scrollHeight, top: el.scrollTop }
    setLimit((n) => n + PAGE)
  }

  const updateDraft = (value: string) => {
    draftRef.current = value
    setDraft(value)
    if (value) drafts.set(agent.id, value)
    else drafts.delete(agent.id)
  }

  const submit = async () => {
    const text = draftRef.current.trim()
    const attached = imagesRef.current
    if ((!text && attached.length === 0) || sending || !caps.send) return
    // An exact command runs its action. An unavailable one is sent as ordinary text, so nothing is silently dropped.
    if (attached.length === 0 && text.startsWith('/') && availableCommands.some((c) => text === `/${c.name}`)) {
      runCommand(text.slice(1))
      return
    }
    if (busy) {
      // Queue it. It is sent when this reply finishes.
      setQueueFor([...queueRef.current, { text, images: attached }])
      updateDraft('')
      setImagesFor([])
      return
    }
    stoppedRef.current = false
    setSending(true)
    const ok = await sendMessage(agent.id, text, toUploads(attached))
    setSending(false)
    // Only clear the composer if it has not changed while the send was in flight.
    if (ok) {
      pinned.current = true
      if (draftRef.current.trim() === text) updateDraft('')
      if (imagesRef.current === attached) setImagesFor([])
    }
  }

  const attachFiles = async (files: File[]) => {
    if (files.length === 0) return
    const { added, problems } = await addImages(files, imagesRef.current.length)
    if (added.length) setImagesFor([...imagesRef.current, ...added])
    setImageNote(problems.join(' '))
  }

  // Pasting an image attaches it. Text pastes behave as usual.
  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith('image/'))
    if (files.length === 0) return
    e.preventDefault()
    void attachFiles(files)
  }

  const onDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (!Array.from(e.dataTransfer.types).includes('Files')) return
    e.preventDefault()
    setDragging(true)
  }

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDragging(false)
    void attachFiles(Array.from(e.dataTransfer.files))
  }

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Enter' || e.nativeEvent.isComposing) return
    if (enterToSend) {
      // Enter sends. Shift+Enter inserts a line. Ctrl/⌘+Enter sends too, for muscle memory from other tools.
      if (!e.shiftKey) {
        e.preventDefault()
        void submit()
      } else if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        void submit()
      }
    } else if (e.ctrlKey || e.metaKey) {
      // Enter-to-send is off: Enter adds a line, and Ctrl/⌘+Enter sends.
      e.preventDefault()
      void submit()
    }
  }

  const canSend = caps.send

  const enterToSend = useStore((s) => s.settings.enterToSend)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <TalkShowcase agent={agent} />
      <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={scrollRef}
        onScroll={onScroll}
        role="log"
        aria-label={`Conversation with ${agent.name}`}
        aria-live="off"
        className="min-h-0 flex-1 overflow-y-auto px-4 py-5"
      >
        {!loaded && error && <LoadError agentId={agent.id} message={error} />}
        {!loaded && !error && <ChatSkeleton />}

        {loaded && timeline.length === 0 && (
          <div className="flex h-full min-h-[200px] flex-col items-center justify-center text-center">
            <div className="mb-3 opacity-80">
              <ProviderMark provider={agent.provider} size={30} />
            </div>
            <p className="text-body font-medium text-ink/85">No messages yet</p>
            <p className="mt-1 max-w-[260px] text-caption leading-relaxed text-faint">
              {canSend
                ? 'Send a message to give this agent work. Its replies and tool calls appear here as it works.'
                : `${agent.providerName} does not accept messages from Orbit. Watch its activity instead.`}
            </p>
          </div>
        )}

        {loaded && hidden > 0 && (
          <div className="mx-auto mb-4 flex max-w-[48rem] justify-center">
            <Button variant="ghost" size="sm" onClick={loadEarlier}>
              Show {Math.min(PAGE, hidden)} earlier
            </Button>
          </div>
        )}

        {loaded && timeline.length > 0 && (
          <div className="mx-auto flex w-full max-w-[48rem] flex-col">
            {groupRuns(shown).map((unit, idx, arr) => {
              // Rows far above the viewport skip layout and paint until scrolled near; this keeps long chats cheap.
              const gap = `${gapBefore(arr[idx - 1], unit)} [content-visibility:auto] [contain-intrinsic-size:auto_72px]`
              if (unit.kind === 'group') {
                return (
                  <div key={unit.key} className={gap}>
                    <ToolGroup tools={unit.tools} />
                  </div>
                )
              }
              const item = unit.item
              const isLast = idx === arr.length - 1
              const live = agent.running && isLast && item.kind === 'message' && item.message.role === 'assistant' && !item.message.streaming
              return (
                <div key={item.key} className={gap}>
                  {item.kind === 'message' ? (
                    <MessageView
                      agentId={agent.id}
                      message={item.message}
                      providerName={agent.providerName}
                      provider={agent.provider}
                      live={live}
                      onRetry={retryKey === item.key ? () => void retryPrompt() : undefined}
                    />
                  ) : item.kind === 'handoff' ? (
                    <HandoffRow handoff={item.handoff} agentId={agent.id} />
                  ) : (
                    <ToolRow tool={item.tool} />
                  )}
                </div>
              )
            })}
            {awaitingReply && (
              <div className="mt-4">
                <Thinking name={agent.providerName} />
              </div>
            )}
          </div>
        )}
      </div>

        {!atBottom && timeline.length > 0 && (
          <button
            type="button"
            onClick={jumpToLatest}
            className="absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-full border border-line-strong bg-popover px-3 py-1 text-label text-muted shadow-lg transition-colors duration-150 hover:text-ink"
          >
            <IconChevronDown size={12} aria-hidden="true" />
            Latest
          </button>
        )}
      </div>

      <div className="shrink-0 border-t border-line p-3">
        {!busy && caps.resume && agent.turns > 0 && (
          <div className="mb-2 flex justify-end">
            <Button variant="ghost" size="sm" onClick={() => void resumeAgent(agent.id)} className="h-6 px-2 text-label">
              <IconPlay size={9} />
              Continue where it stopped
            </Button>
          </div>
        )}

        {canSend && queue.length > 0 && (
          <ul aria-label="Queued messages" className="mb-2 space-y-1">
            {queue.map((q, i) => (
              <li key={i} className="flex items-center gap-2 rounded-lg border border-dashed border-line-strong py-1 pl-2.5 pr-1 text-caption">
                <span className="shrink-0 rounded bg-tint/[0.06] px-1.5 py-px text-label text-muted">Queued</span>
                <span className="min-w-0 flex-1 truncate text-muted">
                  {q.text || 'Image'}
                  {q.images.length > 0 && <span className="ml-1.5 text-faint">· {q.images.length} image{q.images.length === 1 ? '' : 's'}</span>}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label="Remove queued message"
                  title="Remove"
                  onClick={() => setQueueFor(queueRef.current.filter((_, j) => j !== i))}
                  className="h-6 w-6 shrink-0 rounded-md px-0"
                >
                  <IconX size={11} />
                </Button>
              </li>
            ))}
          </ul>
        )}

        {canSend ? (
          <ChatComposer
            agent={agent}
            draft={draft}
            onDraftChange={updateDraft}
            onKeyDown={onKey}
            onPaste={onPaste}
            images={images}
            onRemoveImage={(id) => setImagesFor(imagesRef.current.filter((i) => i.id !== id))}
            imageNote={imageNote}
            dragging={dragging}
            onDragOver={onDragOver}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            onPickFiles={(files) => void attachFiles(files)}
            busy={busy}
            sending={sending}
            onSubmit={() => void submit()}
            onStop={onStop}
            enterToSend={enterToSend}
            commands={availableCommands}
            onCommand={runCommand}
          />
        ) : (
          <p className="text-caption text-faint">Messages are not available for {agent.providerName}.</p>
        )}
      </div>
    </div>
  )
}

// ---- messages ----------------------------------------------------------------------------

/** Memoised: a streamed delta re-renders only the message that changed, not the whole conversation. */
const MessageView = memo(function MessageView({
  agentId,
  message: m,
  providerName,
  provider,
  live = false,
  onRetry,
}: {
  agentId: string
  message: Message
  providerName: string
  provider: string
  live?: boolean
  /** Set only on the newest reply when the agent is idle. Sends the prompt again. */
  onRetry?: () => void
}) {
  if (m.role === 'system') {
    return <p className="text-center text-label text-faint">{m.text}</p>
  }

  if (m.role === 'user') {
    const attachments = m.attachments ?? []
    return (
      <div className="group flex flex-col items-end">
        <span className="text-label text-faint">
          <span className="font-medium text-muted">You</span>
          <span className="ml-1.5 font-mono tabular-nums">{clock(m.at)}</span>
        </span>
        {attachments.length > 0 && (
          <ul aria-label="Attached images" className="mt-1.5 flex max-w-[85%] flex-wrap justify-end gap-1.5">
            {attachments.map((a) => (
              <li key={a.id}>
                <ChatImage agentId={agentId} attachment={a} />
              </li>
            ))}
          </ul>
        )}
        {m.text && (
          <div className="mt-1.5 max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md border border-tint/[0.06] bg-tint/[0.07] px-3.5 py-2 text-body leading-[1.6] text-ink">
            {m.text}
          </div>
        )}
        {m.text && (
          <div className="mt-0.5 opacity-0 transition-opacity duration-150 focus-within:opacity-100 group-hover:opacity-100">
            <CopyButton text={m.text} label="Copy message" />
          </div>
        )}
      </div>
    )
  }

  const done = !m.streaming && !live
  return (
    <div className="group min-w-0">
      <div className="flex items-center gap-2 text-label text-faint">
        <ProviderMark provider={provider} size={16} />
        <span className="font-medium text-muted">{providerName}</span>
        <span className="font-mono tabular-nums">{clock(m.at)}</span>
      </div>
      <div className="mt-1.5 min-w-0 break-words text-body leading-[1.65] text-ink/90">
        {m.text ? <Markdownish text={m.text} /> : done ? <span className="text-faint">No reply text.</span> : null}
        {!done && (
          <span className="ml-0.5 inline-block h-3.5 w-[2px] translate-y-0.5 animate-pulse bg-ink/70 align-middle motion-reduce:animate-none" aria-hidden="true" />
        )}
      </div>
      {done && (m.text || onRetry) && (
        // A reply with no text (for example a failed turn) keeps its actions visible, since they are the only way forward.
        <div className={`-ml-1.5 mt-1 flex items-center gap-1 ${m.text ? 'opacity-0 transition-opacity duration-150 focus-within:opacity-100 group-hover:opacity-100' : ''}`}>
          {m.text && <CopyButton text={m.text} label="Copy reply" />}
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              title="Send the last message again"
              aria-label="Retry the last message"
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-label text-faint transition-colors duration-150 hover:text-ink"
            >
              <IconRetry size={12} aria-hidden="true" />
              <span>Retry</span>
            </button>
          )}
        </div>
      )}
    </div>
  )
})

/**
 * Vertical space before a conversation unit. Turns get the most room, a message and the tool
 * activity around it less, and consecutive tool rows the least, so related activity reads as one block.
 */
function gapBefore(prev: RenderUnit | undefined, cur: RenderUnit): string {
  if (!prev) return ''
  const isTool = (u: RenderUnit) => u.kind === 'group' || u.item.kind === 'tool'
  // A handoff is a divider between two turns, so it gets even space on both sides.
  const isHandoff = (u: RenderUnit) => u.kind === 'item' && u.item.kind === 'handoff'
  if (isHandoff(prev) || isHandoff(cur)) return 'mt-4'
  if (isTool(prev) && isTool(cur)) return 'mt-1'
  if (isTool(prev) || isTool(cur)) return 'mt-3'
  const userTurn = cur.kind === 'item' && cur.item.kind === 'message' && cur.item.message.role === 'user'
  return userTurn ? 'mt-7' : 'mt-5'
}

/** Loaded chat images, keyed by agent and attachment. Bounded, so a long session cannot grow without limit. */
const attachmentCache = new Map<string, string>()
const ATTACHMENT_CACHE_MAX = 40

/** A picture in a sent message. Its pixels come from the backend once, then are reused. */
function ChatImage({ agentId, attachment }: { agentId: string; attachment: Attachment }) {
  const key = `${agentId}:${attachment.id}`
  const [src, setSrc] = useState<string | null>(() => attachmentCache.get(key) ?? null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (src) return
    let live = true
    void attachmentImage(agentId, attachment.id).then((url) => {
      if (!live) return
      if (url) {
        if (attachmentCache.size >= ATTACHMENT_CACHE_MAX) attachmentCache.delete(attachmentCache.keys().next().value as string)
        attachmentCache.set(key, url)
        setSrc(url)
      } else {
        setFailed(true)
      }
    })
    return () => {
      live = false
    }
  }, [agentId, attachment.id, key, src])

  if (failed) {
    return <div className="flex h-24 w-24 items-center justify-center rounded-lg border border-line px-2 text-center text-label text-faint">Image unavailable</div>
  }
  if (!src) {
    return <div role="status" aria-label={`Loading ${attachment.name}`} className="h-24 w-24 animate-pulse rounded-lg border border-line bg-tint/[0.04] motion-reduce:animate-none" />
  }
  return <img src={src} alt={attachment.name} title={attachment.name} className="max-h-48 max-w-[16rem] rounded-lg border border-line object-contain" />
}

function Thinking({ name }: { name: string }) {
  return (
    <div className="flex items-center gap-2.5 text-caption text-muted" role="status">
      <span className="flex gap-1" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted motion-reduce:animate-none"
            style={{ animationDelay: `${i * 160}ms` }}
          />
        ))}
      </span>
      {name} is working on a reply…
    </div>
  )
}

// ---- handoffs ----------------------------------------------------------------------------------

/**
 * A quiet divider where work passed between agents: one line, the other agent's name, and the task.
 * It reads the other agent's name from the store, so a rename shows up here too.
 */
const HandoffRow = memo(function HandoffRow({ handoff: h, agentId }: { handoff: Handoff; agentId: string }) {
  const outgoing = h.fromId === agentId
  const otherId = outgoing ? h.toId : h.fromId
  const other = useStore((s) => s.agents[otherId]?.name ?? 'another agent')
  const failed = h.status === 'failed'
  return (
    <div className="flex min-w-0 items-center gap-2 text-label text-faint">
      <span className="h-px flex-1 bg-line" aria-hidden="true" />
      <span className={`flex min-w-0 max-w-[80%] items-center gap-1.5 ${failed ? 'text-danger-soft' : ''}`}>
        <IconAgent size={11} aria-hidden="true" className="shrink-0" />
        <span className="shrink-0">{outgoing ? 'Handed to' : 'Handed from'}</span>
        <span className="shrink-0 font-medium text-muted">{other}</span>
        {h.task && <span className="min-w-0 truncate">· {h.task}</span>}
        {failed && <span className="shrink-0">· Failed</span>}
      </span>
      <span className="h-px flex-1 bg-line" aria-hidden="true" />
    </div>
  )
})

// ---- tool calls----------------------------------------------------------------------------

const TOOL_TONE: Record<ToolCall['status'], { label: string; color: string }> = {
  running: { label: 'Running', color: STATUS_COLOR.thinking },
  ok: { label: 'Done', color: STATUS_COLOR.completed },
  error: { label: 'Failed', color: STATUS_COLOR.failed },
}

/** One glyph per tool kind, so a glance at the chat shows whether the agent read, edited, ran or searched. */
const TOOL_GLYPH: Record<ToolKind, (p: { size?: number }) => ReactNode> = {
  read: IconFileRead,
  write: IconFileWrite,
  edit: (p) => <IconPencil size={p.size} />,
  shell: IconTerminal,
  search: IconSearch,
  web: IconGlobe,
  agent: IconAgent,
  mcp: IconPlug,
  other: IconTool,
}

/** Status glyph: spinner while running, check when done, cross when failed. */
function ToolStatusIcon({ status, color }: { status: ToolCall['status']; color: string }) {
  if (status === 'running') {
    return (
      <span
        className="inline-block h-3 w-3 animate-spin rounded-full border-[1.5px] border-current border-t-transparent motion-reduce:animate-none"
        style={{ color }}
        aria-hidden="true"
      />
    )
  }
  if (status === 'error') return <IconX size={12} aria-hidden="true" />
  return <IconCheck size={12} aria-hidden="true" />
}

/**
 * A tool call in the conversation. One quiet line by default. Completed calls show only a faint check,
 * while running and failed calls keep their label. Expanding shows the input and result.
 */
const ToolRow = memo(function ToolRow({ tool: t }: { tool: ToolCall }) {
  const [open, setOpen] = useState(false)
  const tone = TOOL_TONE[t.status] ?? TOOL_TONE.running
  const Glyph = TOOL_GLYPH[toolKind(t.name)]
  const id = `tool-${t.id}`
  const done = t.status === 'ok'
  // Measured from the backend's own timestamps, so it is the real run time, not a guess. Empty while running.
  const took = t.endedAt ? duration(t.endedAt - t.at) : ''
  // Only parsed while expanded. A file edit shows its diff; anything else keeps the raw input.
  const edit = open ? editPreview(t.name, t.input) : null
  return (
    <div className={`rounded-md ${t.status === 'error' ? 'bg-danger/[0.06]' : ''}`}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={id}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-caption transition-colors duration-150 hover:bg-tint/[0.04]"
      >
        <IconChevronRight size={11} className={`shrink-0 text-faint transition-transform duration-150 motion-reduce:transition-none ${open ? 'rotate-90' : ''}`} />
        <span className={`shrink-0 ${done ? 'text-faint' : 'text-muted'}`}>
          <Glyph size={12} />
        </span>
        <span className={`shrink-0 font-mono text-caption ${done ? 'text-muted' : 'text-ink'}`}>{t.name || 'Tool'}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-caption text-faint">{t.summary}</span>
        {took && <span className="shrink-0 font-mono text-label tabular-nums text-faint">{took}</span>}
        <span className={`flex shrink-0 items-center gap-1.5 text-label ${done ? 'text-faint' : ''}`} style={done ? undefined : { color: tone.color }}>
          <ToolStatusIcon status={t.status} color={done ? 'currentColor' : tone.color} />
          {done ? <span className="sr-only">{tone.label}</span> : tone.label}
        </span>
      </button>
      {open && (
        <div id={id} className="ml-[26px] mb-1 mt-0.5 space-y-2.5 pr-2">
          {edit ? (
            <ToolDiff preview={edit} />
          ) : (
            <CodeBlock label="Input" text={t.input} />
          )}
          <CodeBlock label="Result" text={t.output} placeholder={t.status === 'running' ? 'Waiting for result…' : 'No output'} danger={t.status === 'error'} />
        </div>
      )}
    </div>
  )
})

/** Words for a summary, per tool kind: [singular, plural]. */
const KIND_WORDS: Record<ToolKind, [string, string]> = {
  read: ['file read', 'files read'],
  write: ['file written', 'files written'],
  edit: ['edit', 'edits'],
  shell: ['command', 'commands'],
  search: ['search', 'searches'],
  web: ['web request', 'web requests'],
  agent: ['agent call', 'agent calls'],
  mcp: ['tool call', 'tool calls'],
  other: ['tool call', 'tool calls'],
}

/** "Completed 3 files read · 2 commands", so a collapsed run still says what happened. */
function summarizeTools(tools: ToolCall[]): string {
  const counts = new Map<ToolKind, number>()
  for (const t of tools) {
    const k = toolKind(t.name)
    counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  const parts = [...counts.entries()].map(([k, n]) => `${n} ${n === 1 ? KIND_WORDS[k][0] : KIND_WORDS[k][1]}`)
  return `Completed ${parts.join(' · ')}`
}

/** A run of completed tool calls, collapsed behind one line. Expands to the individual rows. */
const ToolGroup = memo(function ToolGroup({ tools }: { tools: ToolCall[] }) {
  const [open, setOpen] = useState(false)
  const id = `tools-${tools[0].id}`
  return (
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={id}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-caption text-muted transition-colors duration-150 hover:bg-tint/[0.04] hover:text-ink"
      >
        <IconChevronRight size={11} className={`shrink-0 text-faint transition-transform duration-150 motion-reduce:transition-none ${open ? 'rotate-90' : ''}`} />
        <span className="min-w-0 flex-1 truncate">{summarizeTools(tools)}</span>
        <IconCheck size={11} aria-hidden="true" className="shrink-0 text-faint" />
      </button>
      {open && (
        <div id={id} className="ml-[11px] mt-0.5 space-y-0.5 border-l border-line pl-1.5">
          {tools.map((t) => (
            <ToolRow key={t.id} tool={t} />
          ))}
        </div>
      )}
    </div>
  )
})

type RenderUnit = { key: string; kind: 'item'; item: TimelineItem } | { key: string; kind: 'group'; tools: ToolCall[] }

/**
 * Collapses each run of two or more completed tool calls into one group. Anything else passes
 * through unchanged, so running, failed, and messages are never hidden.
 */
function groupRuns(items: TimelineItem[]): RenderUnit[] {
  const out: RenderUnit[] = []
  let run: Extract<TimelineItem, { kind: 'tool' }>[] = []
  const flush = () => {
    if (run.length >= 2) out.push({ key: `g:${run[0].tool.id}`, kind: 'group', tools: run.map((r) => r.tool) })
    else for (const r of run) out.push({ key: r.key, kind: 'item', item: r })
    run = []
  }
  for (const it of items) {
    if (it.kind === 'tool' && it.tool.status === 'ok') {
      run.push(it)
      continue
    }
    flush()
    out.push({ key: it.key, kind: 'item', item: it })
  }
  flush()
  return out
}

/** Labelled, monospace block with a copy action. Shared by the chat tool rows and the Tools tab. */
export function CodeBlock({ label, text, placeholder = 'Empty', danger = false }: { label: string; text: string; placeholder?: string; danger?: boolean }) {
  const value = text || ''
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      toast('Copied to the clipboard', 'success')
    } catch {
      toast('Could not copy to the clipboard', 'error')
    }
  }
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-label font-medium text-faint">{label}</span>
        {value && (
          <button onClick={() => void copy()} aria-label={`Copy ${label.toLowerCase()}`} className="flex items-center gap-1 rounded px-1 py-0.5 text-label text-faint transition-colors hover:text-ink">
            <IconCopy size={11} />
            Copy
          </button>
        )}
      </div>
      <pre
        className={`max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-line bg-canvas p-2.5 font-mono text-label leading-relaxed ${
          danger ? 'text-danger-soft' : 'text-ink/80'
        }`}
      >
        {value || placeholder}
      </pre>
    </div>
  )
}

// ---- loading & error ---------------------------------------------------------------------------

function ChatSkeleton() {
  return (
    <div className="space-y-5 py-2" role="status" aria-label="Loading conversation">
      {[70, 90, 55].map((w, i) => (
        <div key={i} className={`flex flex-col gap-2 ${i % 2 ? 'items-end' : ''}`}>
          <div className="h-2 w-16 animate-pulse rounded bg-tint/[0.06] motion-reduce:animate-none" />
          <div className="h-8 animate-pulse rounded-xl bg-tint/[0.04] motion-reduce:animate-none" style={{ width: `${w}%` }} />
        </div>
      ))}
    </div>
  )
}

function LoadError({ agentId, message }: { agentId: string; message: string }) {
  return (
    <div className="flex min-h-[200px] flex-col items-center justify-center text-center">
      <p className="text-body font-medium text-ink/85">Couldn’t load this conversation</p>
      <p className="mt-1 max-w-[280px] text-caption leading-relaxed text-faint">{message}</p>
      <Button variant="secondary" size="sm" className="mt-4" onClick={() => void loadDetail(agentId)}>
        <IconRetry size={12} />
        Try again
      </Button>
    </div>
  )
}
