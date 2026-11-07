// Package provider contains one adapter per agent backend. Each adapter turns
// the backend's documented machine-readable output into normalised Updates, so
// the agent manager never needs to know a provider's wire format.
package provider

import (
	"context"
	"sync"
	"time"

	"orbit/internal/model"
)

// Spec describes one turn (one prompt) to run.
type Spec struct {
	AgentID        string
	RepoPath       string
	Prompt         string
	SessionID      string // provider session/thread id; empty for a brand-new session
	Resume         bool   // true when continuing SessionID
	Model          string
	PermissionMode string
	// FastMode asks the provider to run this turn in fast mode. Only set for models that support it.
	FastMode bool
	// UltraFast asks for the account's ultrafast tier on this turn. It implies FastMode. Only set for
	// models whose account offers it.
	UltraFast bool
	// Effort is the thinking effort level for this turn. Empty means the CLI default.
	Effort string
	// Images are files attached to this turn's prompt. Adapters read them as they need.
	Images []Image
	// BrowserCommand is the Orbit executable that serves the browser tool over MCP. Empty
	// leaves the browser out of this turn.
	BrowserCommand string
	// Env is extra environment variables for the process, in KEY=VALUE form.
	Env []string
}

// browserServerName is the MCP server name the browser is registered under.
const browserServerName = "orbit-browser"

// Image is one attached picture, stored on disk by the manager.
type Image struct {
	Path      string
	MediaType string
}

// UpdateKind enumerates the normalised events an adapter can report.
type UpdateKind int

const (
	UpdSession          UpdateKind = iota + 1 // ID = provider session id, Text = model name
	UpdStatus                                 // Status + Detail
	UpdMessageStart                           // ID, Role, Text: a streamed message begins
	UpdMessageDelta                           // ID, Text: streamed text
	UpdMessageEnd                             // ID: streamed message finished
	UpdMessage                                // ID, Role, Text: complete message
	UpdToolStart                              // Tool
	UpdToolEnd                                // ToolID, Output, Failed
	UpdFile                                   // File: a file was read or written
	UpdUsage                                  // Input/Output/CacheRead tokens for a finished turn
	UpdCost                                   // Cost in USD for a finished turn
	UpdIssue                                  // Level (error|warning), Text
	UpdActivity                               // Text: a plain activity line
	UpdTurnDone                               // Success, Text: the turn finished
	UpdSubAgentStart                          // ID = the Task call id, Text = task description, Detail = sub-agent type
	UpdSubAgentActivity                       // ID = the Task call id, Detail = the sub-agent's latest action
	UpdSubAgentEnd                            // ID = the Task call id, Failed
)

// FileTouch describes a read or write. Phase is "start" when the tool begins
// and "end" when it completes.
type FileTouch struct {
	Path  string
	Op    string // read | write
	Tool  string
	Diff  string
	Phase string
}

// Update is one normalised event produced by an adapter.
type Update struct {
	Kind        UpdateKind
	ID          string
	Role        string
	Text        string
	Status      model.Status
	Detail      string
	Tool        *model.ToolCall
	ToolID      string
	Output      string
	Failed      bool
	File        *FileTouch
	InTokens    int64
	OutTokens   int64
	CacheTokens int64
	Cost        float64
	Level       string
	Success     bool
}

// Provider is implemented by every agent backend.
type Provider interface {
	ID() string
	Name() string
	// Detect reports whether the backend is usable on this machine.
	Detect() Detection
	Capabilities() model.Capabilities
	// Run executes one turn, calling emit for every update, and returns when the
	// turn ends. Cancelling ctx stops the turn and must return promptly.
	Run(ctx context.Context, spec Spec, emit func(Update)) error
}

// Detection is the result of looking for a backend.
type Detection struct {
	Available bool   `json:"available"`
	Path      string `json:"path"`
	Hint      string `json:"hint"`
}

// Info is the frontend-facing description of a provider.
type Info struct {
	ID           string             `json:"id"`
	Name         string             `json:"name"`
	Available    bool               `json:"available"`
	Path         string             `json:"path"`
	Hint         string             `json:"hint"`
	Capabilities model.Capabilities `json:"capabilities"`
}

// Registry returns all known providers keyed by id.
func Registry() map[string]Provider {
	list := []Provider{Claude{}, Codex{}, OMP{}, OpenCode{}, Fx{}, Pi{}}
	out := make(map[string]Provider, len(list))
	for _, p := range list {
		out[p.ID()] = p
	}
	return out
}

// infosCache keeps the (slow) provider detection from running on every GetSnapshot. Detection
// results are refreshed at most every few minutes, or when force is needed.
var (
	infosMu    sync.Mutex
	infosAt    time.Time
	infosCache []Info
)

const infosTTL = 2 * time.Minute

// Infos describes every registered provider, in display order. Detection is cached briefly so
// repeated calls (and the window's initial snapshot) stay fast.
func Infos() []Info {
	infosMu.Lock()
	defer infosMu.Unlock()
	if infosCache != nil && time.Since(infosAt) < infosTTL {
		out := make([]Info, len(infosCache))
		copy(out, infosCache)
		return out
	}
	order := []Provider{Claude{}, Codex{}, OMP{}, OpenCode{}, Fx{}, Pi{}}
	out := make([]Info, 0, len(order))
	for _, p := range order {
		d := p.Detect()
		out = append(out, Info{
			ID:           p.ID(),
			Name:         p.Name(),
			Available:    d.Available,
			Path:         d.Path,
			Hint:         d.Hint,
			Capabilities: p.Capabilities(),
		})
	}
	infosCache = out
	infosAt = time.Now()
	return out
}

// ResetInfosCache clears the cached provider detection, so the next Infos() call re-probes.
func ResetInfosCache() {
	infosMu.Lock()
	defer infosMu.Unlock()
	infosCache = nil
	infosAt = time.Time{}
}
