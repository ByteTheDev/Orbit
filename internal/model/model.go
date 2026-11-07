// Package model holds the data types shared by the agent manager, persistence
// and the Wails bindings. Everything here is JSON-serialisable.
package model

// Status is the observable state of an agent.
type Status string

const (
	StatusIdle      Status = "idle"
	StatusThinking  Status = "thinking"
	StatusWriting   Status = "writing"
	StatusReading   Status = "reading"
	StatusWaiting   Status = "waiting"
	StatusCompleted Status = "completed"
	StatusFailed    Status = "failed"
	StatusStopped   Status = "stopped"
)

// Caps bound the history kept per agent so memory and the persisted state stay small.
const (
	MaxMessages    = 300
	MaxTools       = 300
	MaxActivity    = 500
	MaxIssues      = 100
	MaxFileOps     = 30
	MaxTextBytes   = 64 << 10
	MaxToolIO      = 8 << 10
	MaxDiffBytes   = 16 << 10
	MaxSnapshotLen = 200 << 10
)

// Point is a position in the universe's world coordinates.
type Point struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

// Project groups agents that work on one repository.
type Project struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	RepoPath  string `json:"repoPath"`
	CreatedAt int64  `json:"createdAt"`
	// Icon is the letter shown on the project's sun. Empty means the first letter of Name.
	Icon string `json:"icon,omitempty"`
	// IconRev is non-zero when the project has an uploaded PNG icon. It changes on every
	// upload, so the UI can cache the image by revision and never show a stale one.
	IconRev int64 `json:"iconRev,omitempty"`
	// AutoCommit commits the files an agent wrote, once each turn finishes successfully.
	AutoCommit bool `json:"autoCommit,omitempty"`
}

// MaxIconRunes bounds a project icon so it stays legible on a sun.
const MaxIconRunes = 2

// Limits for an uploaded PNG icon.
const (
	MaxIconBytes  = 2 << 20 // 2 MiB on disk
	MaxIconPixels = 2048    // per side
)

// PermissionMode is one choice offered for a provider.
type PermissionMode struct {
	ID          string `json:"id"`
	Label       string `json:"label"`
	Description string `json:"description"`
}

// Capabilities describes which operations a provider really supports.
// The UI only shows controls whose capability is true.
type Capabilities struct {
	Stop            bool             `json:"stop"`
	Resume          bool             `json:"resume"`
	Send            bool             `json:"send"`
	Cost            bool             `json:"cost"`
	Streaming       bool             `json:"streaming"`
	PermissionModes []PermissionMode `json:"permissionModes"`
	// Models lists the models a launch may choose from. Empty means the provider decides.
	Models []ModelOption `json:"models"`
}

// HasModel reports whether id is one of the offered models.
func (c Capabilities) HasModel(id string) bool {
	for _, m := range c.Models {
		if m.ID == id {
			return true
		}
	}
	return false
}

// SupportsEffort reports whether the offered model id accepts the effort level.
func (c Capabilities) SupportsEffort(id, level string) bool {
	for _, m := range c.Models {
		if m.ID == id {
			for _, e := range m.Effort {
				if e == level {
					return true
				}
			}
			return false
		}
	}
	return false
}

// SupportsFastMode reports whether the offered model id can run in fast mode.
func (c Capabilities) SupportsFastMode(id string) bool {
	for _, m := range c.Models {
		if m.ID == id {
			return m.FastMode
		}
	}
	return false
}

// ModelOption is one model a provider offers. ID is what the CLI receives.
type ModelOption struct {
	ID          string `json:"id"`
	Label       string `json:"label"`
	Group       string `json:"group"`
	Description string `json:"description"`
	// FastMode is true when the provider can run this model in fast mode.
	FastMode bool `json:"fastMode"`
	// Effort lists the thinking effort levels this model accepts, lowest first. Empty means the
	// model has no effort control.
	Effort []string `json:"effort"`
	// DefaultEffort is the level the CLI uses when none is given. Informational only.
	DefaultEffort string `json:"defaultEffort"`
}

// Usage is cumulative token and cost accounting for an agent.
type Usage struct {
	InputTokens     int64   `json:"inputTokens"`
	OutputTokens    int64   `json:"outputTokens"`
	CacheReadTokens int64   `json:"cacheReadTokens"`
	CostUSD         float64 `json:"costUsd"`
}

// Message is one chat entry.
type Message struct {
	ID          string       `json:"id"`
	Role        string       `json:"role"` // user | assistant | system
	Text        string       `json:"text"`
	Streaming   bool         `json:"streaming"`
	At          int64        `json:"at"`
	Attachments []Attachment `json:"attachments,omitempty"`
}

// Attachment is an image sent with a chat message. The bytes are stored beside the state
// file; the message keeps only what the chat needs to show it.
type Attachment struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	MediaType string `json:"mediaType"`
}

// ImageUpload is an image the window sends with a message. Data is base64 with no data-URL prefix.
type ImageUpload struct {
	Name      string `json:"name"`
	MediaType string `json:"mediaType"`
	Data      string `json:"data"`
}

const (
	// MaxAttachments is how many images one message may carry.
	MaxAttachments = 4
	// MaxAttachmentBytes caps one image before base64. Base64 adds a third, which keeps the
	// encoded image under the 5 MB per-image limit of the Claude API.
	MaxAttachmentBytes = 3750 << 10
)

// ToolCall is one tool invocation made by the agent.
type ToolCall struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Summary string `json:"summary"`
	Input   string `json:"input"`
	Output  string `json:"output"`
	Status  string `json:"status"` // running | ok | error
	At      int64  `json:"at"`
}

// MaxSubAgents bounds the sub-agents kept per agent. Old finished ones fall off first.
const MaxSubAgents = 8

// SubAgent is one sub-agent an agent started with its Task tool. It orbits its parent as a small
// icon while it works, and shows what it is doing.
type SubAgent struct {
	ID      string `json:"id"`     // the Task tool call's id
	Name    string `json:"name"`   // the task description
	Kind    string `json:"kind"`   // the sub-agent type, e.g. general-purpose
	Status  string `json:"status"` // running | ok | error
	Detail  string `json:"detail"` // the sub-agent's latest action
	Actions int    `json:"actions"`
	At      int64  `json:"at"`
	DoneAt  int64  `json:"doneAt,omitempty"`
}

// ActivityEntry is one line of the live activity stream.
type ActivityEntry struct {
	ID   int64  `json:"id"`
	Kind string `json:"kind"` // status | tool | file | message | error | warning | system
	Text string `json:"text"`
	At   int64  `json:"at"`
}

// Issue is a recent error or warning.
type Issue struct {
	ID    int64  `json:"id"`
	Level string `json:"level"` // error | warning
	Text  string `json:"text"`
	At    int64  `json:"at"`
}

// FileOpRecord is one recorded read or write of a file.
type FileOpRecord struct {
	Op   string `json:"op"` // read | write
	Tool string `json:"tool"`
	At   int64  `json:"at"`
	Diff string `json:"diff,omitempty"`
}

// FileActivity is the per-agent record of one file. State drives the planet's visual treatment.
type FileActivity struct {
	Path   string         `json:"path"`
	Reads  int            `json:"reads"`
	Writes int            `json:"writes"`
	State  string         `json:"state"` // reading | writing | recent
	LastOp string         `json:"lastOp"`
	LastAt int64          `json:"lastAt"`
	Ops    []FileOpRecord `json:"ops,omitempty"`
}

// ConflictAgent identifies an agent that wrote a conflicting file.
type ConflictAgent struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// Conflict is a file written by more than one agent in the same project.
type Conflict struct {
	Path   string          `json:"path"`
	Agents []ConflictAgent `json:"agents"`
}

// Handoff statuses. A handoff is active from delegation until the receiving agent's turn ends.
const (
	HandoffActive = "active"
	HandoffDone   = "done"
	HandoffFailed = "failed"
)

// Handoff is one task one agent delegated to another in the same project. The galaxy draws
// it as a beam between the two planets. Handoffs are live state and are not persisted.
type Handoff struct {
	ID        string `json:"id"`
	ProjectID string `json:"projectId"`
	FromID    string `json:"fromId"`
	ToID      string `json:"toId"`
	Task      string `json:"task"`
	Status    string `json:"status"` // active | done | failed
	At        int64  `json:"at"`
	DoneAt    int64  `json:"doneAt,omitempty"`
}

// Conversation statuses. A conversation is active until it reaches its reply limit (done),
// is stopped by the user or an agent is removed (stopped), or a turn fails (failed).
const (
	ConvActive  = "active"
	ConvDone    = "done"
	ConvStopped = "stopped"
	ConvFailed  = "failed"
)

// Conversation is a live back-and-forth between two agents in one project. Each finished reply
// is passed to the other agent as its next message. Conversations are live state, not persisted.
type Conversation struct {
	ID         string `json:"id"`
	ProjectID  string `json:"projectId"`
	AgentAID   string `json:"agentAId"`
	AgentBID   string `json:"agentBId"`
	Topic      string `json:"topic"`
	Status     string `json:"status"` // active | done | stopped | failed
	NextID     string `json:"nextId"` // the agent whose turn is running or due next
	Replies    int    `json:"replies"`
	MaxReplies int    `json:"maxReplies"`
	Error      string `json:"error,omitempty"`
	At         int64  `json:"at"`
	DoneAt     int64  `json:"doneAt,omitempty"`
}

// AgentRecord is the complete, persisted state of one agent.
type AgentRecord struct {
	ID             string `json:"id"`
	ProjectID      string `json:"projectId"`
	Name           string `json:"name"`
	Provider       string `json:"provider"`
	Model          string `json:"model"`
	Task           string `json:"task"`
	PermissionMode string `json:"permissionMode"`
	Status         Status `json:"status"`
	StatusDetail   string `json:"statusDetail"`
	SessionID      string `json:"sessionId"`
	// SessionSeen is true once the provider has confirmed the session, so the
	// next turn must resume it rather than create it.
	SessionSeen bool `json:"sessionSeen"`
	Running     bool `json:"running"`
	FastMode    bool `json:"fastMode"`
	// Effort is the thinking effort level for this agent's turns. Empty means the CLI default.
	Effort       string                   `json:"effort"`
	Position     *Point                   `json:"position,omitempty"`
	CreatedAt    int64                    `json:"createdAt"`
	UpdatedAt    int64                    `json:"updatedAt"`
	RunStartedAt int64                    `json:"runStartedAt"`
	Turns        int                      `json:"turns"`
	ToolCalls    int                      `json:"toolCalls"`
	Usage        Usage                    `json:"usage"`
	LastError    string                   `json:"lastError"`
	Files        map[string]*FileActivity `json:"files"`
	Messages     []Message                `json:"messages"`
	Tools        []ToolCall               `json:"tools"`
	SubAgents    []SubAgent               `json:"subAgents"`
	Activity     []ActivityEntry          `json:"activity"`
	Issues       []Issue                  `json:"issues"`
	Seq          int64                    `json:"seq"`
}

// AgentSummary is the light view sent for every agent in batched events.
type AgentSummary struct {
	ID             string `json:"id"`
	ProjectID      string `json:"projectId"`
	Name           string `json:"name"`
	Provider       string `json:"provider"`
	ProviderName   string `json:"providerName"`
	Model          string `json:"model"`
	Task           string `json:"task"`
	PermissionMode string `json:"permissionMode"`
	Status         Status `json:"status"`
	StatusDetail   string `json:"statusDetail"`
	SessionID      string `json:"sessionId"`
	Running        bool   `json:"running"`
	FastMode       bool   `json:"fastMode"`
	// Effort is the thinking effort level for this agent's turns. Empty means the CLI default.
	Effort       string `json:"effort"`
	Position     *Point `json:"position,omitempty"`
	CreatedAt    int64  `json:"createdAt"`
	UpdatedAt    int64  `json:"updatedAt"`
	RunStartedAt int64  `json:"runStartedAt"`
	Turns        int    `json:"turns"`
	ToolCalls    int    `json:"toolCalls"`
	Usage        Usage  `json:"usage"`
	LastError    string `json:"lastError"`
	FileCount    int    `json:"fileCount"`
	WriteCount   int    `json:"writeCount"`
	IssueCount   int    `json:"issueCount"`
	// RecentFiles is the most recently touched files, without diffs.
	RecentFiles []FileActivity `json:"recentFiles"`
	// RecentTools holds the tool calls still running, oldest first, without input or output. Each orbits as a rock.
	RecentTools  []ToolCall   `json:"recentTools"`
	// SubAgents are the agent's latest sub-agents, oldest first. They orbit the planet as icons.
	SubAgents    []SubAgent   `json:"subAgents"`
	Capabilities Capabilities `json:"capabilities"`
}

// AgentDetail is the full view loaded when an agent is inspected.
type AgentDetail struct {
	AgentSummary
	Messages []Message       `json:"messages"`
	Tools    []ToolCall      `json:"tools"`
	Activity []ActivityEntry `json:"activity"`
	Issues   []Issue         `json:"issues"`
	Files    []FileActivity  `json:"files"`
}

// ProjectSummary is a project with live counts and detected conflicts.
type ProjectSummary struct {
	Project
	AgentCount    int            `json:"agentCount"`
	RunningCount  int            `json:"runningCount"`
	Conflicts     []Conflict     `json:"conflicts"`
	Handoffs      []Handoff      `json:"handoffs"`
	Conversations []Conversation `json:"conversations"`
}

// Event is one entry in a batched update sent to the frontend.
type Event struct {
	Type      string          `json:"type"` // agent | agentRemoved | project | projectRemoved | message | delta | messageEnd | tool | activity | file | issue
	ID        string          `json:"id,omitempty"`
	AgentID   string          `json:"agentId,omitempty"`
	MessageID string          `json:"messageId,omitempty"`
	Text      string          `json:"text,omitempty"`
	Agent     *AgentSummary   `json:"agent,omitempty"`
	Project   *ProjectSummary `json:"project,omitempty"`
	Message   *Message        `json:"message,omitempty"`
	Tool      *ToolCall       `json:"tool,omitempty"`
	Activity  *ActivityEntry  `json:"activity,omitempty"`
	File      *FileActivity   `json:"file,omitempty"`
	Issue     *Issue          `json:"issue,omitempty"`
}

// Truncate shortens s to at most max bytes, marking the cut.
func Truncate(s string, max int) string {
	if len(s) <= max {
		return s
	}
	cut := max
	// Avoid splitting a UTF-8 sequence.
	for cut > 0 && s[cut]&0xC0 == 0x80 {
		cut--
	}
	return s[:cut] + "\n…[truncated]"
}

// LimitWindow is one allowance a provider reports, such as the 5-hour or weekly window.
type LimitWindow struct {
	Label       string  `json:"label"`
	UsedPercent float64 `json:"usedPercent"`
	// ResetsAt is when the window resets, in unix milliseconds. 0 when unknown.
	ResetsAt int64 `json:"resetsAt"`
}

// ProviderLimits is the account's allowance as the provider's CLI reports it.
type ProviderLimits struct {
	Provider string        `json:"provider"`
	Plan     string        `json:"plan"`
	Windows  []LimitWindow `json:"windows"`
	// Error says why the limits could not be read. Empty when Windows is current.
	Error string `json:"error"`
	// CheckedAt is when the CLI was asked, in unix milliseconds.
	CheckedAt int64 `json:"checkedAt"`
}
