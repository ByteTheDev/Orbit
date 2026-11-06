// Thin wrapper over the Wails-generated bindings. Every backend call goes
// through here so that a missing backend (plain browser preview) produces one
// clear error instead of scattered failures.
import type {
  AgentDetail,
  AgentSummary,
  FileDiffResult,
  LaunchRequest,
  OrbitEvent,
  ProjectSummary,
  Snapshot,
} from '../types'

// Lazily loaded so the module still imports when the bindings are absent.
type Runtime = typeof import('../../wailsjs/runtime/runtime')
type Bindings = typeof import('../../wailsjs/go/main/App')

let bindings: Bindings | null = null
let runtime: Runtime | null = null

export const EVENT_NAME = 'orbit:events'

export function inWails(): boolean {
  return typeof window !== 'undefined' && 'go' in window
}

async function load(): Promise<void> {
  if (bindings && runtime) return
  if (!inWails()) throw new Error('Orbit’s backend is not connected.')
  const [b, r] = await Promise.all([
    import('../../wailsjs/go/main/App'),
    import('../../wailsjs/runtime/runtime'),
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
    off = runtime.EventsOn(EVENT_NAME, (batch: OrbitEvent[]) => handler(batch)) as unknown as (() => void) | undefined
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
  pickRepository: () => call<string>((b) => b.PickRepository()),
  createProject: (name: string, repoPath: string) =>
    call<ProjectSummary>((b) => b.CreateProject(name, repoPath)),
  deleteProject: (projectId: string) => call<void>((b) => b.DeleteProject(projectId)),
  setProjectIcon: (projectId: string, icon: string) => call<void>((b) => b.SetProjectIcon(projectId, icon)),
  setProjectIconImage: (projectId: string, pngBase64: string) =>
    call<void>((b) => b.SetProjectIconImage(projectId, pngBase64)),
  getProjectIcon: (projectId: string) => call<string>((b) => b.GetProjectIcon(projectId)),
  launchAgent: (req: LaunchRequest) => call<AgentSummary>((b) => b.LaunchAgent(req as never)),
  sendMessage: (agentId: string, text: string) => call<void>((b) => b.SendMessage(agentId, text)),
  resumeAgent: (agentId: string) => call<void>((b) => b.ResumeAgent(agentId)),
  stopAgent: (agentId: string) => call<void>((b) => b.StopAgent(agentId)),
  removeAgent: (agentId: string) => call<void>((b) => b.RemoveAgent(agentId)),
  renameAgent: (agentId: string, name: string) => call<void>((b) => b.RenameAgent(agentId, name)),
  setAgentPosition: (agentId: string, x: number, y: number) =>
    call<void>((b) => b.SetAgentPosition(agentId, x, y)),
  openTerminal: (terminalId: string, projectId: string, cols: number, rows: number) =>
    call<void>((b) => b.OpenTerminal(terminalId, projectId, cols, rows)),
  writeTerminal: (terminalId: string, data: string) => call<void>((b) => b.WriteTerminal(terminalId, data)),
  resizeTerminal: (terminalId: string, cols: number, rows: number) => call<void>((b) => b.ResizeTerminal(terminalId, cols, rows)),
  closeTerminal: (terminalId: string) => call<void>((b) => b.CloseTerminal(terminalId)),
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
    const outputOff = runtime.EventsOn('terminal:output', (e: { id: string; data: string }) => handlers.output(e.id, e.data))
    const exitOff = runtime.EventsOn('terminal:exit', (e: { id: string }) => handlers.exit(e.id))
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
