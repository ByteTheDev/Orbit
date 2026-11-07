// A small external store. Components subscribe to slices with selectors, so a
// batch of agent events re-renders only the parts of the UI that changed.
import { useSyncExternalStore } from 'react'
import { clampSidebarWidth, loadSidebarPrefs, saveSidebarPrefs } from './sidebarPrefs'
import {
  TOAST_MS,
  applySettings,
  loadSettings,
  normaliseSettings,
  resolveReducedMotion,
  saveSettings,
  type Settings,
} from './settings'
import type {
  ActivityEntry,
  AgentSummary,
  FileActivity,
  Issue,
  Message,
  OrbitEvent,
  ProjectSummary,
  ProviderInfo,
  ProviderLimits,
  Snapshot,
  ToolCall,
} from '../types'

export type InspectorTab = 'overview' | 'chat' | 'files' | 'changes'

export type Dialog =
  | { kind: 'project' }
  | { kind: 'launch'; projectId?: string }
  | { kind: 'file'; agentId: string; path: string }
  | { kind: 'settings'; section?: 'keyboard' }
  | { kind: 'remove'; agentId: string }
  | { kind: 'deleteProject'; projectId: string }
  | { kind: 'projectIcon'; projectId: string }
  | { kind: 'browser'; url?: string }
  | null

export interface Toast {
  id: number
  tone: 'info' | 'error' | 'success'
  text: string
}

/** Per-agent history, loaded on demand when an agent is inspected. */
export interface Details {
  loaded: boolean
  messages: Message[]
  tools: ToolCall[]
  activity: ActivityEntry[]
  issues: Issue[]
  files: Record<string, FileActivity>
}

export interface State {
  connected: boolean
  loading: boolean
  connectError: string | null
  storageError: string | null
  statePath: string
  providers: ProviderInfo[]
  /** Each provider's usage allowance. Refreshed by refreshLimits. Empty until the first read. */
  limits: ProviderLimits[]
  projects: Record<string, ProjectSummary>
  projectOrder: string[]
  agents: Record<string, AgentSummary>
  agentOrder: string[]
  details: Record<string, Details>
  /** Why an agent's history failed to load. Cleared when a load succeeds. */
  detailErrors: Record<string, string>
  selectedId: string | null
  inspectorOpen: boolean
  inspectorTab: InspectorTab
  projectsOpen: boolean
  /** Sidebar width in px, within SIDEBAR_MIN..SIDEBAR_MAX. Persisted by setSidebar. */
  sidebarWidth: number
  /** Narrow rail of project marks instead of the full navigator. Persisted by setSidebar. */
  sidebarCollapsed: boolean
  /** Full-width dashboard of every agent across every project. */
  dashboardOpen: boolean
  activeProjectId: string | null
  focus: { id: string; nonce: number } | null
  dialog: Dialog
  toasts: Toast[]
  /** Effective reduced-motion flag: the Settings choice, falling back to the OS setting. */
  reducedMotion: boolean
  /** User preferences. Persisted by setSettings and applied to the document. */
  settings: Settings
}

const MAX_ACTIVITY = 500
const MAX_ISSUES = 100
const MAX_MESSAGES = 300
const MAX_TOOLS = 300

let toastSeq = 0
let focusSeq = 0

const initial: State = {
  connected: false,
  loading: true,
  connectError: null,
  storageError: null,
  statePath: '',
  providers: [],
  projects: {},
  projectOrder: [],
  agents: {},
  agentOrder: [],
  details: {},
  detailErrors: {},
  selectedId: null,
  inspectorOpen: false,
  inspectorTab: 'overview',
  limits: [],
  projectsOpen: true,
  sidebarWidth: loadSidebarPrefs().width,
  sidebarCollapsed: loadSidebarPrefs().collapsed,
  dashboardOpen: false,
  activeProjectId: null,
  focus: null,
  dialog: null,
  toasts: [],
  reducedMotion: false,
  settings: loadSettings(),
}

// The OS reduced-motion preference, kept apart so a Settings choice can override it and then be undone.
let systemReducedMotion =
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
initial.reducedMotion = resolveReducedMotion(initial.settings.motion, systemReducedMotion)
applySettings(initial.settings, initial.reducedMotion)

let state: State = initial
const listeners = new Set<() => void>()

export function getState(): State {
  return state
}

export function setState(patch: Partial<State> | ((s: State) => Partial<State>)): void {
  const next = typeof patch === 'function' ? patch(state) : patch
  state = { ...state, ...next }
  listeners.forEach((l) => l())
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useStore<T>(selector: (s: State) => T): T {
  return useSyncExternalStore(subscribe, () => selector(state), () => selector(state))
}

// ---- snapshot & events ------------------------------------------------------

function sortedIds(map: Record<string, { createdAt: number }>): string[] {
  return Object.keys(map).sort((a, b) => map[a].createdAt - map[b].createdAt)
}

export function applySnapshot(snap: Snapshot): void {
  const projects: Record<string, ProjectSummary> = {}
  for (const p of snap.projects) projects[p.id] = p
  const agents: Record<string, AgentSummary> = {}
  for (const a of snap.agents) agents[a.id] = a
  setState((s) => ({
    connected: true,
    loading: false,
    connectError: null,
    storageError: snap.storageError || null,
    statePath: snap.statePath,
    providers: snap.providers,
    projects,
    projectOrder: sortedIds(projects),
    agents,
    agentOrder: sortedIds(agents),
    activeProjectId: s.activeProjectId && projects[s.activeProjectId] ? s.activeProjectId : (snap.projects[0]?.id ?? null),
    selectedId: s.selectedId && agents[s.selectedId] ? s.selectedId : null,
  }))
}

/**
 * Applies one batch of backend events in a single state update. Maps are copied
 * only when they change, so detail events (chat, tools) do not invalidate the
 * universe or the sidebar.
 */
export function applyEvents(batch: OrbitEvent[]): void {
  if (batch.length === 0) return
  const s = state
  let projects = s.projects
  let agents = s.agents
  let details = s.details
  let projectOrder = s.projectOrder
  let agentOrder = s.agentOrder
  let selectedId = s.selectedId
  let activeProjectId = s.activeProjectId
  let projectsCopied = false
  let agentsCopied = false
  let detailsCopied = false

  const ownProjects = () => {
    if (!projectsCopied) {
      projects = { ...projects }
      projectsCopied = true
    }
    return projects
  }
  const ownAgents = () => {
    if (!agentsCopied) {
      agents = { ...agents }
      agentsCopied = true
    }
    return agents
  }
  const ownDetails = () => {
    if (!detailsCopied) {
      details = { ...details }
      detailsCopied = true
    }
    return details
  }
  /** Returns the agent's loaded details, or undefined when they are not being shown. */
  const loadedDetail = (id: string): Details | undefined => {
    const d = details[id]
    return d?.loaded ? d : undefined
  }

  for (const ev of batch) {
    // A malformed event is skipped rather than allowed to throw inside the reducer.
    if (!wellFormed(ev)) continue
    switch (ev.type) {
      case 'agent': {
        const isNew = !agents[ev.id]
        ownAgents()[ev.id] = ev.agent
        if (isNew) agentOrder = sortedIds(agents)
        break
      }
      case 'agentRemoved': {
        delete ownAgents()[ev.id]
        delete ownDetails()[ev.id]
        agentOrder = agentOrder.filter((id) => id !== ev.id)
        if (selectedId === ev.id) selectedId = null
        break
      }
      case 'project': {
        if (!projects[ev.id]) projectOrder = [...projectOrder, ev.id]
        ownProjects()[ev.id] = ev.project
        if (!activeProjectId) activeProjectId = ev.id
        break
      }
      case 'projectRemoved': {
        delete ownProjects()[ev.id]
        projectOrder = projectOrder.filter((id) => id !== ev.id)
        if (activeProjectId === ev.id) activeProjectId = projectOrder[0] ?? null
        break
      }
      case 'message': {
        const d = loadedDetail(ev.agentId)
        if (!d) break
        const idx = findLast(d.messages, (m) => m.id === ev.message!.id)
        const messages = idx >= 0 ? replaceAt(d.messages, idx, ev.message!) : cap([...d.messages, ev.message!], MAX_MESSAGES)
        ownDetails()[ev.agentId] = { ...d, messages }
        break
      }
      case 'delta': {
        const d = loadedDetail(ev.agentId)
        if (!d) break
        const idx = findLast(d.messages, (m) => m.id === ev.messageId)
        if (idx < 0) break
        const msg = d.messages[idx]
        ownDetails()[ev.agentId] = { ...d, messages: replaceAt(d.messages, idx, { ...msg, text: msg.text + ev.text, streaming: true }) }
        break
      }
      case 'messageEnd': {
        const d = loadedDetail(ev.agentId)
        if (!d) break
        const idx = findLast(d.messages, (m) => m.id === ev.messageId)
        if (idx < 0) break
        ownDetails()[ev.agentId] = { ...d, messages: replaceAt(d.messages, idx, { ...d.messages[idx], streaming: false }) }
        break
      }
      case 'tool': {
        const d = loadedDetail(ev.agentId)
        if (!d) break
        const idx = findLast(d.tools, (t) => t.id === ev.tool!.id)
        const tools = idx >= 0 ? replaceAt(d.tools, idx, ev.tool!) : cap([...d.tools, ev.tool!], MAX_TOOLS)
        ownDetails()[ev.agentId] = { ...d, tools }
        break
      }
      case 'activity': {
        const d = loadedDetail(ev.agentId)
        if (!d) break
        ownDetails()[ev.agentId] = { ...d, activity: cap([...d.activity, ev.activity!], MAX_ACTIVITY) }
        break
      }
      case 'issue': {
        const d = loadedDetail(ev.agentId)
        if (!d) break
        ownDetails()[ev.agentId] = { ...d, issues: cap([...d.issues, ev.issue!], MAX_ISSUES) }
        break
      }
      case 'file': {
        const d = loadedDetail(ev.agentId)
        if (!d) break
        const prev = d.files[ev.file!.path]
        // Keep recorded operations when the light file event omits them.
        const merged: FileActivity = { ...ev.file!, ops: ev.file!.ops ?? prev?.ops }
        ownDetails()[ev.agentId] = { ...d, files: { ...d.files, [ev.file!.path]: merged } }
        break
      }
    }
  }

  setState({ projects, projectOrder, agents, agentOrder, details, selectedId, activeProjectId })
}

/** A detail payload as it arrives from the backend. Any collection may be missing or null. */
export interface DetailPayload {
  messages?: Message[] | null
  tools?: ToolCall[] | null
  activity?: ActivityEntry[] | null
  issues?: Issue[] | null
  files?: FileActivity[] | null
}

/** Treats a missing or null collection as empty, so a partial payload can never crash the inspector. */
function list<T>(value: T[] | null | undefined): T[] {
  return Array.isArray(value) ? value : []
}

/**
 * Stores a fully loaded detail for one agent, replacing any previous copy. Items that
 * lack the fields the UI keys on are dropped, so one bad record cannot break a list.
 */
export function setDetail(agentId: string, payload: DetailPayload | null | undefined): void {
  const p: DetailPayload = payload ?? {}
  const messages = list(p.messages).filter((m) => typeof m?.id === 'string')
  const tools = list(p.tools).filter((t) => typeof t?.id === 'string')
  const activity = list(p.activity).filter((a) => a && (typeof a.id === 'number' || typeof a.id === 'string'))
  const issues = list(p.issues).filter((i) => i && (typeof i.id === 'number' || typeof i.id === 'string'))
  const files: Record<string, FileActivity> = {}
  for (const f of list(p.files)) if (typeof f?.path === 'string' && f.path !== '') files[f.path] = f
  setState((s) => {
    const detailErrors = agentId in s.detailErrors ? omit(s.detailErrors, agentId) : s.detailErrors
    return {
      details: { ...s.details, [agentId]: { loaded: true, messages, tools, activity, issues, files } },
      detailErrors,
    }
  })
}

/** Records that an agent's history could not be loaded, or clears the record when msg is null. */
export function setDetailError(agentId: string, msg: string | null): void {
  setState((s) => {
    if (msg === null) return agentId in s.detailErrors ? { detailErrors: omit(s.detailErrors, agentId) } : {}
    return { detailErrors: { ...s.detailErrors, [agentId]: msg } }
  })
}

/** Events the reducer can apply. Anything else is ignored rather than trusted. */
function wellFormed(ev: OrbitEvent): boolean {
  if (!ev || typeof ev !== 'object') return false
  switch (ev.type) {
    case 'agent':
      return typeof ev.id === 'string' && !!ev.agent
    case 'project':
      return typeof ev.id === 'string' && !!ev.project
    case 'message':
      return typeof ev.agentId === 'string' && typeof ev.message?.id === 'string'
    case 'delta':
    case 'messageEnd':
      return typeof ev.agentId === 'string' && typeof ev.messageId === 'string'
    case 'tool':
      return typeof ev.agentId === 'string' && typeof ev.tool?.id === 'string'
    case 'activity':
      return typeof ev.agentId === 'string' && !!ev.activity
    case 'issue':
      return typeof ev.agentId === 'string' && !!ev.issue
    case 'file':
      return typeof ev.agentId === 'string' && typeof ev.file?.path === 'string' && ev.file.path !== ''
    default:
      return true
  }
}

function omit<T>(map: Record<string, T>, key: string): Record<string, T> {
  const next = { ...map }
  delete next[key]
  return next
}

// ---- UI actions -----------------------------------------------------------------

export function selectAgent(id: string | null, opts: { openInspector?: boolean } = {}): void {
  setState((s) => {
    const agent = id ? s.agents[id] : undefined
    return {
      selectedId: id,
      inspectorOpen: id ? (opts.openInspector ?? true) : false,
      activeProjectId: agent ? agent.projectId : s.activeProjectId,
    }
  })
}

/** Asks the universe to fly the camera to an agent. */
export function focusAgent(id: string): void {
  setState((s) => ({
    focus: { id, nonce: ++focusSeq },
    activeProjectId: s.agents[id]?.projectId ?? s.activeProjectId,
  }))
}

export function setInspectorTab(tab: InspectorTab): void {
  setState({ inspectorTab: tab, inspectorOpen: true })
}

/** Sets sidebar width and/or collapsed state, clamps the width, and remembers both for next launch. */
export function setSidebar(patch: { width?: number; collapsed?: boolean }): void {
  setState((s) => ({
    sidebarWidth: patch.width === undefined ? s.sidebarWidth : clampSidebarWidth(patch.width),
    sidebarCollapsed: patch.collapsed ?? s.sidebarCollapsed,
  }))
  saveSidebarPrefs({ width: getState().sidebarWidth, collapsed: getState().sidebarCollapsed })
}

/** Merges a settings change, saves it, and applies it to the document straight away. */
export function setSettings(patch: Partial<Settings>): void {
  const settings = normaliseSettings({ ...getState().settings, ...patch })
  const reducedMotion = resolveReducedMotion(settings.motion, systemReducedMotion)
  saveSettings(settings)
  applySettings(settings, reducedMotion)
  setState({ settings, reducedMotion })
}

/** Called when the OS reduced-motion preference changes. */
export function setSystemReducedMotion(reduced: boolean): void {
  systemReducedMotion = reduced
  setState({ reducedMotion: resolveReducedMotion(getState().settings.motion, reduced) })
  applySettings(getState().settings, getState().reducedMotion)
}

export function openDialog(dialog: Dialog): void {
  setState({ dialog })
}

export function closeDialog(): void {
  setState({ dialog: null })
}

export function toast(text: string, tone: Toast['tone'] = 'info'): void {
  const id = ++toastSeq
  setState((s) => ({ toasts: [...s.toasts.slice(-3), { id, tone, text }] }))
  const base = TOAST_MS[getState().settings.toastLength]
  window.setTimeout(() => dismissToast(id), tone === 'error' ? Math.max(base, 6000) : base)
}

export function dismissToast(id: number): void {
  setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
}

// ---- helpers --------------------------------------------------------------------

function findLast<T>(list: T[], pred: (item: T) => boolean): number {
  for (let i = list.length - 1; i >= 0; i--) if (pred(list[i])) return i
  return -1
}

function replaceAt<T>(list: T[], idx: number, item: T): T[] {
  const next = list.slice()
  next[idx] = item
  return next
}

function cap<T>(list: T[], max: number): T[] {
  return list.length > max ? list.slice(list.length - max) : list
}
