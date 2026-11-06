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
}

export interface ConflictAgent {
  id: string
  name: string
}

export interface Conflict {
  path: string
  agents: ConflictAgent[]
}

export interface ProjectSummary extends Project {
  agentCount: number
  runningCount: number
  conflicts: Conflict[]
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
  capabilities: Capabilities
}

export interface Message {
  id: string
  role: 'user' | 'assistant' | 'system'
  text: string
  streaming: boolean
  at: number
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
  kind: 'status' | 'tool' | 'file' | 'message' | 'error' | 'warning' | 'system'
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

export interface LaunchRequest {
  projectId: string
  name: string
  provider: string
  model: string
  permissionMode: string
  task: string
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
