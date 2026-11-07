// Thin wrapper over the Wails-generated bindings. Every backend call goes
// through here so that a missing backend (plain browser preview) produces one
// clear error instead of scattered failures.
import type {
  AgentDetail,
  AgentSummary,
  Automation,
  Conversation,
  BranchInfo,
  BrowserPage,
  FileDiffResult,
  GitCommit,
  GitStatus,
  ImageUpload,
  LaunchRequest,
  OrbitEvent,
  ProviderLimits,
  ProjectSummary,
  ReleaseInfo,
  Snapshot,
  SSHProfile,
} from '../types'

// Lazily loaded so the module still imports when the bindings are absent.
type Runtime = typeof import('@wailsio/runtime')
type Bindings = typeof import('../../bindings/orbit/app')

let bindings: Bindings | null = null
let runtime: Runtime | null = null

export const EVENT_NAME = 'orbit:events'
export const AUTOMATIONS_EVENT = 'orbit:automations'

export function inWails(): boolean {
  return typeof window !== 'undefined' && '_wails' in window
}

async function load(): Promise<void> {
  if (bindings && runtime) return
  if (!inWails()) throw new Error('Orbit’s backend is not connected.')
  const [b, r] = await Promise.all([
    import('../../bindings/orbit/app'),
    import('@wailsio/runtime'),
  ])
  bindings = b as unknown as Bindings
  runtime = r as unknown as Runtime
}

async function call<T>(fn: (b: Bindings) => Promise<unknown>): Promise<T> {
  await load()
  return (await fn(bindings as Bindings)) as T
}

/** Subscribes to batched backend events. Returns an unsubscribe function. */
export function onEvents(handler: (batch: OrbitEvent[]) => void): () => void {
  if (!inWails()) return () => {}
  let off: (() => void) | undefined
  let cancelled = false
  void load().then(() => {
    if (cancelled || !runtime) return
    off = runtime.Events.On(EVENT_NAME, (event) => handler(event.data as OrbitEvent[])) as unknown as (() => void) | undefined
  })
  return () => {
    cancelled = true
    off?.()
  }
}

export const api = {
  getSnapshot: () => call<Snapshot>((b) => b.GetSnapshot()),
  getAgentDetail: (agentId: string) => call<AgentDetail>((b) => b.GetAgentDetail(agentId)),
  getFileDiff: (agentId: string, path: string) =>
    call<FileDiffResult>((b) => b.GetFileDiff(agentId, path)),
  getGitStatus: (projectId: string) => call<GitStatus>((b) => b.GetGitStatus(projectId)),
  getGitDiff: (projectId: string, path: string, staged: boolean, untracked: boolean) =>
    call<string>((b) => b.GetGitDiff(projectId, path, staged, untracked)),
  getGitLog: (projectId: string) => call<GitCommit[]>((b) => b.GetGitLog(projectId)),
  stageFiles: (projectId: string, paths: string[]) => call<void>((b) => b.StageFiles(projectId, paths)),
  unstageFiles: (projectId: string, paths: string[]) => call<void>((b) => b.UnstageFiles(projectId, paths)),
  commitChanges: (projectId: string, message: string, paths: string[]) =>
    call<string>((b) => b.CommitChanges(projectId, message, paths)),
  setProjectAutoCommit: (projectId: string, on: boolean) => call<void>((b) => b.SetProjectAutoCommit(projectId, on)),
  pickRepository: () => call<string>((b) => b.PickRepository()),
  createProject: (name: string, repoPath: string) =>
    call<ProjectSummary>((b) => b.CreateProject(name, repoPath)),
  deleteProject: (projectId: string) => call<void>((b) => b.DeleteProject(projectId)),
  setProjectIcon: (projectId: string, icon: string) => call<void>((b) => b.SetProjectIcon(projectId, icon)),
  setProjectIconImage: (projectId: string, pngBase64: string) =>
    call<void>((b) => b.SetProjectIconImage(projectId, pngBase64)),
  getProjectIcon: (projectId: string) => call<string>((b) => b.GetProjectIcon(projectId)),
  launchAgent: (req: LaunchRequest) => call<AgentSummary>((b) => b.LaunchAgent(req as never)),
  launchTeam: (first: LaunchRequest, partners: LaunchRequest[], task: string, maxReplies: number) =>
    call<Conversation>((b) => b.LaunchTeam(first as never, partners as never, task, maxReplies)),
  startTalk: (aId: string, bId: string, task: string, maxReplies: number) =>
    call<Conversation>((b) => b.Collaborate(aId, bId, task, maxReplies)),
  stopTalk: (talkId: string) => call<void>((b) => b.StopConversation(talkId)),
  saveAutomation: (auto: Automation) => call<void>((b) => b.SaveAutomation(auto as never)),
  deleteAutomation: (id: string) => call<void>((b) => b.DeleteAutomation(id)),
  runAutomation: (id: string) => call<void>((b) => b.RunAutomation(id)),
  projectBranches: (projectId: string) => call<BranchInfo>((b) => b.ProjectBranches(projectId)),
  listProjectFiles: (projectId: string, relPath: string) => call<string[]>((b) => b.ListProjectFiles(projectId, relPath)),
  sendMessage: (agentId: string, text: string, images: ImageUpload[]) => call<void>((b) => b.SendMessage(agentId, text, images)),
  attachmentImage: (agentId: string, attachmentId: string) =>
    call<string>((b) => b.AttachmentImage(agentId, attachmentId)),
  getLimits: (force: boolean) => call<ProviderLimits[]>((b) => b.GetLimits(force)),
  resumeAgent: (agentId: string) => call<void>((b) => b.ResumeAgent(agentId)),
  stopAgent: (agentId: string) => call<void>((b) => b.StopAgent(agentId)),
  removeAgent: (agentId: string) => call<void>((b) => b.RemoveAgent(agentId)),
  renameAgent: (agentId: string, name: string) => call<void>((b) => b.RenameAgent(agentId, name)),
  acknowledgeAgent: (agentId: string) => call<void>((b) => b.AcknowledgeAgent(agentId)),
  setAgentPosition: (agentId: string, x: number, y: number) =>
    call<void>((b) => b.SetAgentPosition(agentId, x, y)),
  openTerminal: (terminalId: string, projectId: string, cols: number, rows: number) =>
    call<void>((b) => b.OpenTerminal(terminalId, projectId, cols, rows)),
  writeTerminal: (terminalId: string, data: string) => call<void>((b) => b.WriteTerminal(terminalId, data)),
  resizeTerminal: (terminalId: string, cols: number, rows: number) => call<void>((b) => b.ResizeTerminal(terminalId, cols, rows)),
  closeTerminal: (terminalId: string) => call<void>((b) => b.CloseTerminal(terminalId)),
  browserFetch: (address: string) => call<BrowserPage>((b) => b.BrowserFetch(address)),
  browserOpenExternal: (address: string) => call<void>((b) => b.BrowserOpenExternal(address)),
  checkForUpdate: () => call<ReleaseInfo>((b) => b.CheckForUpdate()),
  setAgentPermission: (agentId: string, mode: string) => call<AgentSummary>((b) => b.SetAgentPermission(agentId, mode)),
  setAgentBranch: (agentId: string, branch: string) => call<AgentSummary>((b) => b.SetAgentBranch(agentId, branch)),
  setAgentModel: (agentId: string, modelId: string, effort: string, fastMode: boolean, ultraFast: boolean) =>
    call<AgentSummary>((b) => b.SetAgentModel(agentId, modelId, effort, fastMode, ultraFast)),
  browserPaneSupported: () => call<boolean>((b) => b.BrowserPaneSupported()),
  browserPaneOpen: (address: string, x: number, y: number, w: number, h: number) =>
    call<void>((b) => b.BrowserPaneOpen(address, x, y, w, h)),
  browserPaneNavigate: (address: string) => call<void>((b) => b.BrowserPaneNavigate(address)),
  browserPaneSetBounds: (x: number, y: number, w: number, h: number) => call<void>((b) => b.BrowserPaneSetBounds(x, y, w, h)),
  browserPaneBack: () => call<void>((b) => b.BrowserPaneBack()),
  browserPaneForward: () => call<void>((b) => b.BrowserPaneForward()),
  browserPaneReload: () => call<void>((b) => b.BrowserPaneReload()),
  browserPaneStop: () => call<void>((b) => b.BrowserPaneStop()),
  browserPaneHide: () => call<void>((b) => b.BrowserPaneHide()),
  browserPaneClose: () => call<void>((b) => b.BrowserPaneClose()),
  listSSHProfiles: () => call<SSHProfile[]>((b) => b.ListSSHProfiles()),
  saveSSHProfile: (p: SSHProfile) => call<SSHProfile>((b) => b.SaveSSHProfile(p as never)),
  deleteSSHProfile: (id: string) => call<void>((b) => b.DeleteSSHProfile(id)),
  testSSHProfile: (id: string) => call<void>((b) => b.TestSSHProfile(id)),
  runSSHCommand: (id: string, command: string) => call<string>((b) => b.RunSSHCommand(id, command)),
}

/** Subscribes to the full automation list, sent whenever it changes. Returns an unsubscribe function. */
export function onAutomations(handler: (list: Automation[]) => void): () => void {
  if (!inWails()) return () => {}
  let off: (() => void) | undefined
  let cancelled = false
  void load().then(() => {
    if (cancelled || !runtime) return
    off = runtime.Events.On(AUTOMATIONS_EVENT, (event) => handler(event.data as Automation[])) as unknown as () => void
  })
  return () => {
    cancelled = true
    off?.()
  }
}

/** What the native page view reports. Each event carries the full state. */
export interface BrowserPaneState {
  url: string
  title: string
  loading: boolean
  error?: string
}

/** Subscribes to the page view's state. Returns an unsubscribe function. */
export function onBrowserPane(handler: (s: BrowserPaneState) => void): () => void {
  if (!inWails()) return () => {}
  let off: (() => void) | undefined
  let cancelled = false
  void load().then(() => {
    if (cancelled || !runtime) return
    off = runtime.Events.On('browser:pane', (event) => handler(event.data as BrowserPaneState)) as unknown as () => void
  })
  return () => {
    cancelled = true
    off?.()
  }
}

export interface TerminalHandlers {
  output: (terminalId: string, data: string) => void
  exit: (terminalId: string) => void
}

/** Subscribes to terminal output and exit events. Returns an unsubscribe function. */
export function onTerminalEvents(handlers: TerminalHandlers): () => void {
  if (!inWails()) return () => {}
  const offs: Array<() => void> = []
  let cancelled = false
  void load().then(() => {
    if (cancelled || !runtime) return
    const outputOff = runtime.Events.On('terminal:output', (event) => { const e = event.data as { id: string; data: string }; handlers.output(e.id, e.data) })
    const exitOff = runtime.Events.On('terminal:exit', (event) => { const e = event.data as { id: string }; handlers.exit(e.id) })
    offs.push(outputOff as unknown as () => void, exitOff as unknown as () => void)
  })
  return () => {
    cancelled = true
    offs.forEach((off) => off?.())
  }
}

export function errorText(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  return 'Something went wrong.'
}
