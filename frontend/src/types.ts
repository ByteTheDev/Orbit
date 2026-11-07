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

/** One message in a talk: the opening topic (no agentId, from the user) or one agent's reply. */
export interface ConversationLine {
  agentId: string
  name: string
  provider: string
  text: string
  at: number
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
  /** The agents in the talk, in speaking order. agentAId and agentBId are the first two. */
  members: string[]
  /** The transcript, oldest first: the topic, then each reply. */
  lines: ConversationLine[]
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
  /** True when the signed-in account can run this model in ultrafast mode. */
  ultraFast: boolean
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
  /** The git branch the agent works on, when it has its own worktree or was launched on one. */
  branch?: string
  permissionMode: string
  status: Status
  statusDetail: string
  sessionId: string
  running: boolean
  /** The agent runs in fast mode. */
  fastMode: boolean
  /** The agent runs in ultrafast mode, which implies fast mode. */
  ultraFast: boolean
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
  /** When the result arrived. Absent while the tool is still running. */
  endedAt?: number
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

/** The newest published Orbit release, as the update check reports it. */
export interface ReleaseInfo {
  version: string
  /** Unix milliseconds. */
  publishedAt: number
  notes: string
  url: string
}

/** A scheduled launch. Mirrors internal/model/automation.go. */
export type SSHAuthMethod = 'password' | 'key' | 'agent'

export interface SSHProfile {
  id: string
  name: string
  host: string
  port: number
  user: string
  auth: SSHAuthMethod
  password?: string
  keyPath?: string
  passphrase?: string
  createdAt: number
}

export interface Automation {
  id: string
  name: string
  projectId: string
  /** A disabled automation keeps its settings but never fires. */
  enabled: boolean
  /** Weekdays to run on: 0 is Sunday through 6 is Saturday. Sorted, without duplicates. */
  days: number[]
  /** Local time of day, 24-hour "HH:MM". */
  time: string
  provider: string
  /** Empty uses the provider's default model. */
  model: string
  /** Empty uses the provider's first permission mode. */
  permissionMode: string
  task: string
  /** Unix milliseconds. */
  createdAt: number
  /** Scheduled time of the last slot handled, launched or skipped. Unix milliseconds. */
  lastRunAt: number
  /** Why the last run could not start its agent. Empty after a successful run. */
  lastError: string
  /** Next scheduled run, Unix milliseconds. 0 when disabled. */
  nextRunAt: number
}

export interface Snapshot {
  projects: ProjectSummary[]
  agents: AgentSummary[]
  automations: Automation[]
  providers: ProviderInfo[]
  statePath: string
  storageError: string
  version: string
}

/** git's view of one file, as the Changes tab reports it. Null in the result when the file is unchanged. */
export interface GitFileState {
  index: string
  worktree: string
  staged: boolean
  unstaged: boolean
  untracked: boolean
  oldPath?: string
}

export interface FileDiffResult {
  path: string
  /** Relative to the project folder, as the file APIs expect. Empty when the path is outside it. */
  rel: string
  /** The diff of the agent's latest recorded edit to this file. */
  recorded: string
  /** The working tree against HEAD, from git. Empty when there is no change or no repository. */
  gitDiff: string
  /** Why there is no git diff, when there is none for a reason other than no change. */
  gitNotice: string
  exists: boolean
  size: number
  /** Unix milliseconds. */
  modTime: number
  git: GitFileState | null
}

/** One recorded read or write of a file by an agent in the same project. */
export interface FileEvent {
  agentId: string
  agentName: string
  op: 'read' | 'write'
  tool: string
  /** Unix milliseconds. */
  at: number
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
  /** Git could not merge this path. It must be edited, then staged. */
  conflicted: boolean
}

export interface GitStatus {
  /** Empty when HEAD is detached. */
  branch: string
  hasCommits: boolean
  changes: GitChange[]
  /** The remote branch this branch tracks. Empty when there is none. */
  upstream: string
  ahead: number
  behind: number
  /** Whether the repository has any remote. Fetch, pull and push need one. */
  remote: boolean
  conflicts: number
}

export interface GitCommit {
  hash: string
  short: string
  subject: string
  author: string
  /** Unix milliseconds. */
  at: number
  /** The agent that wrote this commit, from its Orbit-Agent trailer. Empty for other commits. */
  agent: string
}

export interface GitCommitFile {
  path: string
  oldPath?: string
  /** A added, M modified, D deleted, R renamed, C copied, T type changed. */
  status: string
  additions: number
  deletions: number
  binary: boolean
}

export interface GitCommitDetail extends GitCommit {
  body: string
  files: GitCommitFile[]
}

/** One change to discard. Mirrors gitdiff.DiscardTarget. */
export interface GitDiscardTarget {
  path: string
  oldPath?: string
  index: string
  worktree: string
  untracked: boolean
}

/** One entry in the Files sidebar: a file or folder, relative to the project root. */
export interface FileEntry {
  name: string
  path: string
  isDir: boolean
  link?: boolean
  size: number
  /** Unix milliseconds. */
  modTime: number
}

export interface FileListing {
  entries: FileEntry[]
  truncated: boolean
}

export interface FileMatches {
  entries: FileEntry[]
  truncated: boolean
}

/** A file loaded for the editor. Binary and oversized files come back without content. */
export interface FileText {
  path: string
  content: string
  size: number
  modTime: number
  binary: boolean
  tooLarge: boolean
}

/** A debounced batch of changes in the watched project. */
export interface ProjectFilesChange {
  projectId: string
  /** Folders whose contents changed, relative to the root. The root is "". */
  dirs: string[]
  /** Branch, HEAD or history moved. */
  git: boolean
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
  /** Run in ultrafast mode, which implies fast mode. The backend refuses it unless the account offers it. */
  ultraFast: boolean
  /** Thinking effort. Empty uses the CLI default. The backend refuses levels the model does not offer. */
  effort: string
  /** Git branch to work on. Empty uses the project folder as it is. With newBranch, a new branch to create. */
  branch: string
  /** Create `branch` from HEAD instead of using an existing one. */
  newBranch: boolean
  /** Images pasted into the task box. They go with the first message. Empty when there are none. */
  images: ImageUpload[]
}

/** A project's git branches, for the launch dialog. */
export interface BranchInfo {
  /** Checked out in the project folder. Empty when HEAD is detached. */
  current: string
  branches: string[]
  /** Folder that holds this project's worktrees. */
  worktreeRoot: string
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
