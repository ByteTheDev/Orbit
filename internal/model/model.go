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

// ModelOption is one model a provider offers. ID is what the CLI receives.
type ModelOption struct {
	ID          string `json:"id"`
	Label       string `json:"label"`
	Group       string `json:"group"`
	Description string `json:"description"`
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
	ID        string `json:"id"`
	Role      string `json:"role"` // user | assistant | system
	Text      string `json:"text"`
	Streaming bool   `json:"streaming"`
	At        int64  `json:"at"`
}

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
	SessionSeen  bool                     `json:"sessionSeen"`
	Running      bool                     `json:"running"`
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
	Position       *Point `json:"position,omitempty"`
	CreatedAt      int64  `json:"createdAt"`
	UpdatedAt      int64  `json:"updatedAt"`
	RunStartedAt   int64  `json:"runStartedAt"`
	Turns          int    `json:"turns"`
	ToolCalls      int    `json:"toolCalls"`
	Usage          Usage  `json:"usage"`
	LastError      string `json:"lastError"`
	FileCount      int    `json:"fileCount"`
	WriteCount     int    `json:"writeCount"`
	IssueCount     int    `json:"issueCount"`
	// RecentFiles is the most recently touched files, without diffs, for the orbiting file planets.
	RecentFiles  []FileActivity `json:"recentFiles"`
	Capabilities Capabilities   `json:"capabilities"`
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
	AgentCount   int        `json:"agentCount"`
	RunningCount int        `json:"runningCount"`
	Conflicts    []Conflict `json:"conflicts"`
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
