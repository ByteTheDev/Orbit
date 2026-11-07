// Mirrors the JSON produced by the Go backend (internal/model and app.go).

export type Status =
  | 'idle'
  | 'thinking'
  | 'writing'
  | 'reading'
  | 'waiting'
  | 'completed'
  | 'failed'
  | 'stopped'

export const ACTIVE_STATUSES: readonly Status[] = ['thinking', 'writing', 'reading', 'waiting']

export interface Point {
  x: number
  y: number
}

export interface Project {
  id: string
  name: string
  repoPath: string
  createdAt: number
  /** Letter shown on the project's sun. Absent means the first letter of the name. */
  icon?: string
  /** Non-zero when an uploaded PNG icon exists. Changes on each upload, so it keys the image cache. */
  iconRev?: number
  /** When on, each completed turn commits the files the agent wrote. */
  autoCommit?: boolean
}

export interface ConflictAgent {
  id: string
  name: string
}

export interface Conflict {
  path: string
  agents: ConflictAgent[]
}

/** A task one agent delegated to another. Active until the receiving agent's turn ends. */
export interface Handoff {
  id: string
  projectId: string
  fromId: string
  toId: string
  task: string
  status: 'active' | 'done' | 'failed'
  at: number
  doneAt?: number
}

/** A live talk between two agents in one project. Each reply is passed to the other agent. */
export interface Conversation {
  id: string
  projectId: string
  agentAId: string
  agentBId: string
  topic: string
  status: 'active' | 'done' | 'stopped' | 'failed'
  /** The agent whose turn is running or due next. */
  nextId: string
  replies: number
  maxReplies: number
  error?: string
  at: number
  doneAt?: number
}

export interface ProjectSummary extends Project {
  agentCount: number
  runningCount: number
  conflicts: Conflict[]
  handoffs: Handoff[]
  conversations: Conversation[]
}

export interface PermissionMode {
  id: string
  label: string
  description: string
}

export interface ModelOption {
  /** The id the CLI receives, e.g. `claude-opus-5-5`. */
  id: string
  label: string
  group: string
  description: string
  /** True when the provider can run this model in fast mode. */
  fastMode: boolean
  /** Thinking effort levels this model accepts, lowest first. Empty means no effort control. */
  effort: string[]
  /** The level the CLI uses when none is chosen. Informational. */
  defaultEffort: string
}

export interface Capabilities {
  stop: boolean
  resume: boolean
  send: boolean
  cost: boolean
  streaming: boolean
  permissionModes: PermissionMode[]
  /** Models a launch may choose from. Absent or empty means the provider picks its own default. */
  models?: ModelOption[]
}

export interface Usage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  costUsd: number
}

export interface AgentSummary {
  id: string
  projectId: string
  name: string
  provider: string
  providerName: string
  model: string
  task: string
  permissionMode: string
  status: Status
  statusDetail: string
  sessionId: string
  running: boolean
  /** The agent runs in fast mode. */
  fastMode: boolean
  /** Thinking effort for this agent's turns. Empty means the CLI default. */
  effort: string
  position?: Point
  createdAt: number
  updatedAt: number
  runStartedAt: number
  turns: number
  toolCalls: number
  usage: Usage
  lastError: string
  fileCount: number
  writeCount: number
  issueCount: number
  recentFiles: FileActivity[]
  recentTools: ToolCall[]
  subAgents: SubAgent[]
  capabilities: Capabilities
}

/** An image the composer sends with a message. Data is base64 without a data-URL prefix. */
export interface ImageUpload {
  name: string
  mediaType: string
  data: string
}

/** An image sent with a chat message. The webview fetches its pixels on demand. */
export interface Attachment {
  id: string
  name: string
  mediaType: string
}

export interface Message {
  id: string
  role: 'user' | 'assistant' | 'system'
  text: string
  streaming: boolean
  at: number
  /** Absent when the message has no images. */
  attachments?: Attachment[]
}

/** A sub-agent an agent started with its Task tool. Orbits its parent as a small icon. */
export interface SubAgent {
  id: string
  name: string
  kind: string
  status: string
  detail: string
  actions: number
  at: number
  doneAt?: number
}

export interface ToolCall {
  id: string
  name: string
  summary: string
  input: string
  output: string
  status: 'running' | 'ok' | 'error'
  at: number
}

export interface ActivityEntry {
  id: number
  kind: 'status' | 'tool' | 'file' | 'message' | 'error' | 'warning' | 'system' | 'commit'
  text: string
  at: number
}

export interface Issue {
  id: number
  level: 'error' | 'warning'
  text: string
  at: number
}

export interface FileOpRecord {
  op: 'read' | 'write'
  tool: string
  at: number
  diff?: string
}

export type FileState = 'reading' | 'writing' | 'recent'

export interface FileActivity {
  path: string
  reads: number
  writes: number
  state: FileState
  lastOp: string
  lastAt: number
  ops?: FileOpRecord[]
}

export interface AgentDetail extends AgentSummary {
  messages: Message[]
  tools: ToolCall[]
  activity: ActivityEntry[]
  issues: Issue[]
  files: FileActivity[]
}

export interface ProviderInfo {
  id: string
  name: string
  available: boolean
  path: string
  hint: string
  capabilities: Capabilities
}

export interface Snapshot {
  projects: ProjectSummary[]
  agents: AgentSummary[]
  providers: ProviderInfo[]
  statePath: string
  storageError: string
  version: string
}

export interface FileDiffResult {
  path: string
  recorded: string
  gitDiff: string
  gitNotice: string
}

/** One changed path from `git status`. A path can be staged and unstaged at once. */
export interface GitChange {
  path: string
  oldPath?: string
  staged: boolean
  unstaged: boolean
  untracked: boolean
  /** git's one-letter codes for the index and worktree sides (M, A, D, R, ?, space). */
  index: string
  worktree: string
}

export interface GitStatus {
  /** Empty when HEAD is detached. */
  branch: string
  hasCommits: boolean
  changes: GitChange[]
}

export interface GitCommit {
  hash: string
  short: string
  subject: string
  author: string
  /** Unix milliseconds. */
  at: number
}

export interface LaunchRequest {
  projectId: string
  name: string
  provider: string
  model: string
  permissionMode: string
  task: string
  /** Run in fast mode. The backend refuses it unless the model supports it. */
  fastMode: boolean
  /** Thinking effort. Empty uses the CLI default. The backend refuses levels the model does not offer. */
  effort: string
}

/** One usage window a provider reports, such as the 5-hour or weekly allowance. */
export interface LimitWindow {
  label: string
  /** Share of the window already used, 0 to 100. */
  usedPercent: number
  /** When the window resets, unix milliseconds. 0 when unknown. */
  resetsAt: number
}

/** A provider's account allowance, as its CLI reports it. */
export interface ProviderLimits {
  provider: string
  plan: string
  windows: LimitWindow[]
  /** Why the limits could not be read. Empty when windows are current. */
  error: string
  /** When the CLI was asked, unix milliseconds. */
  checkedAt: number
}

/** An anchor on a web page, resolved to an absolute address. */
export interface BrowserLink {
  text: string
  url: string
}

/** A web page as the built-in browser reads it. Mirrors internal/browser.Page. */
export interface BrowserPage {
  url: string
  status: number
  contentType: string
  title: string
  text: string
  links: BrowserLink[]
  truncated: boolean
}

export type OrbitEvent =
  | { type: 'agent'; id: string; agent: AgentSummary }
  | { type: 'agentRemoved'; id: string }
  | { type: 'project'; id: string; project: ProjectSummary }
  | { type: 'projectRemoved'; id: string }
  | { type: 'message'; agentId: string; message: Message }
  | { type: 'delta'; agentId: string; messageId: string; text: string }
  | { type: 'messageEnd'; agentId: string; messageId: string }
  | { type: 'tool'; agentId: string; tool: ToolCall }
  | { type: 'activity'; agentId: string; activity: ActivityEntry }
  | { type: 'file'; agentId: string; file: FileActivity }
  | { type: 'issue'; agentId: string; issue: Issue }
