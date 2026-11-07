package provider

import (
	"context"
	"encoding/json"
	"errors"
	"os/exec"
	"strings"
	"sync"
	"time"

	"orbit/internal/model"
)

// Fx adapts the Vercel fx CLI in non-interactive mode:
//
//	fx ask --json ...
//
// The prompt is sent on stdin. Sessions are continued with --resume <id>.
type Fx struct{}

func (Fx) ID() string   { return "fx" }
func (Fx) Name() string { return "Fx" }

func (Fx) Detect() Detection {
	p, ok := lookPath("fx")
	if !ok {
		return Detection{Hint: "Install the fx CLI and sign in with `fx login`."}
	}
	return Detection{Available: true, Path: p}
}

func (Fx) Capabilities() model.Capabilities {
	return model.Capabilities{
		Stop:      true,
		Resume:    true,
		Send:      true,
		Cost:      false,
		Streaming: false,
		PermissionModes: []model.PermissionMode{
			{ID: "ask", Label: "Ask first", Description: "Prompts for approval before running tools."},
			{ID: "auto", Label: "Auto", Description: "Runs safe actions automatically and asks when needed."},
			{ID: "full-access", Label: "Full access", Description: "Disables fx permission checks for the run. Use only in repos you trust."},
		},
		Models: fxModelList(),
	}
}

// Run executes one turn of an fx session.
func (f Fx) Run(ctx context.Context, spec Spec, emit func(Update)) error {
	d := f.Detect()
	if !d.Available {
		return errors.New("fx is not installed or not on PATH")
	}
	if len(spec.Images) != 0 {
		// images are passed as flags, not rejected
	}
	parser := &fxParser{}
	return runProcess(ctx, procSpec{Bin: d.Path, Args: fxArgs(spec), Dir: spec.RepoPath, Stdin: spec.Prompt}, parser.parse, emit)
}

// fxArgs builds the fx command line for one turn.
func fxArgs(spec Spec) []string {
	args := []string{"ask", "--json"}
	if spec.Resume && spec.SessionID != "" {
		args = append(args, "--resume", spec.SessionID)
	}
	mode := spec.PermissionMode
	if mode != "" {
		switch mode {
		case "full-access", "full_access", "bypassPermissions", "danger-full-access", "full access":
			args = append(args, "--full-access")
		case "auto":
			args = append(args, "--auto")
		case "ask":
			args = append(args, "--ask")
		default:
			args = append(args, "--permission-mode", mode)
		}
	}
	if spec.Model != "" {
		args = append(args, "--model", spec.Model)
	}
	if spec.Effort != "" {
		args = append(args, "--effort", spec.Effort)
	}
	if spec.FastMode {
		args = append(args, "--fast")
	}
	for _, img := range spec.Images {
		args = append(args, "--image", img.Path)
	}
	if spec.BrowserCommand != "" {
		// fx has no per-run MCP flag documented; leave the browser out.
	}
	return args
}

// ---- model discovery ---------------------------------------------------------

type fxModelCache struct {
	mu   sync.Mutex
	at   time.Time
	data []model.ModelOption
}

var fxModelsCache fxModelCache

const fxModelCacheTTL = 5 * time.Minute

func fxModelList() []model.ModelOption {
	fxModelsCache.mu.Lock()
	defer fxModelsCache.mu.Unlock()
	if fxModelsCache.data != nil && time.Since(fxModelsCache.at) < fxModelCacheTTL {
		return fxModelsCache.data
	}
	list := fetchFxModels()
	fxModelsCache.data = list
	fxModelsCache.at = time.Now()
	return list
}

func fetchFxModels() []model.ModelOption {
	d := Fx{}.Detect()
	if !d.Available {
		return []model.ModelOption{}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, d.Path, "models", "--json")
	configureProcess(cmd)
	out, err := cmd.Output()
	if err != nil {
		return []model.ModelOption{}
	}
	// Try an array of objects first.
	var payload []struct {
		ID            string   `json:"id"`
		Name          string   `json:"name"`
		Model         string   `json:"model"`
		Label         string   `json:"label"`
		Provider      string   `json:"provider"`
		Effort        []string `json:"effort"`
		Reasoning     []string `json:"reasoning"`
		ReasoningLevels []string `json:"reasoning_levels"`
		Fast          bool     `json:"fast"`
		FastMode      bool     `json:"fast_mode"`
		Ultrafast     bool     `json:"ultrafast"`
	}
	if err := json.Unmarshal(out, &payload); err == nil && len(payload) > 0 {
		out2 := make([]model.ModelOption, 0, len(payload))
		for _, m := range payload {
			id := m.ID
			if id == "" {
				id = m.Model
			}
			if id == "" {
				continue
			}
			label := m.Label
			if label == "" {
				label = m.Name
			}
			if label == "" {
				label = id
			}
			group := m.Provider
			if group == "" {
				if i := strings.IndexByte(id, '/'); i >= 0 {
					group = id[:i]
				}
			}
			effort := m.Effort
			if len(effort) == 0 {
				effort = m.Reasoning
			}
			if len(effort) == 0 {
				effort = m.ReasoningLevels
			}
			fast := m.Fast || m.FastMode || m.Ultrafast
			out2 = append(out2, model.ModelOption{
				ID:       id,
				Label:    label,
				Group:    group,
				FastMode: fast,
				Effort:   effort,
			})
		}
		if len(out2) > 0 {
			return out2
		}
	}
	// Fall back to an array of strings.
	var ids []string
	if err := json.Unmarshal(out, &ids); err == nil {
		out2 := make([]model.ModelOption, 0, len(ids))
		seen := map[string]bool{}
		for _, id := range ids {
			id = strings.TrimSpace(id)
			if id == "" || seen[id] {
				continue
			}
			seen[id] = true
			group := id
			if i := strings.IndexByte(id, '/'); i >= 0 {
				group = id[:i]
			}
			out2 = append(out2, model.ModelOption{ID: id, Label: id, Group: group})
		}
		return out2
	}
	// Fall back to newline-delimited output.
	out2 := []model.ModelOption{}
	seen := map[string]bool{}
	for _, line := range strings.Split(string(out), "\n") {
		id := strings.TrimSpace(line)
		if id == "" || seen[id] {
			continue
		}
		seen[id] = true
		group := id
		if i := strings.IndexByte(id, '/'); i >= 0 {
			group = id[:i]
		}
		out2 = append(out2, model.ModelOption{ID: id, Label: id, Group: group})
	}
	return out2
}

// ---- wire format -----------------------------------------------------------

type fxParser struct{ session string }

func (p *fxParser) parse(line []byte) []Update {
	var e struct {
		SessionID   string `json:"session_id"`
		Model       string `json:"model"`
		Output      string `json:"output"`
		FinalOutput string `json:"final_output"`
		Error       string `json:"error"`
		ExitCode    int    `json:"exit_code"`
		Usage       *struct {
			InputTokens     *int64 `json:"input_tokens"`
			OutputTokens    *int64 `json:"output_tokens"`
			CacheReadTokens *int64 `json:"cache_read_tokens"`
			CacheWriteTokens *int64 `json:"cache_write_tokens"`
		} `json:"usage"`
		ToolCalls []struct {
			Name   string `json:"name"`
			Status string `json:"status"`
		} `json:"tool_calls"`
	}
	if json.Unmarshal(line, &e) != nil {
		return nil
	}
	// Only treat JSON that looks like an fx result.
	if e.SessionID == "" && e.FinalOutput == "" && e.Output == "" && e.Error == "" && len(e.ToolCalls) == 0 {
		return nil
	}
	var out []Update
	if e.SessionID != "" && p.session != e.SessionID {
		p.session = e.SessionID
		out = append(out, Update{Kind: UpdSession, ID: e.SessionID, Text: e.Model})
	}
	text := e.FinalOutput
	if text == "" {
		text = e.Output
	}
	for _, tc := range e.ToolCalls {
		if tc.Name != "" {
			out = append(out, Update{Kind: UpdActivity, Text: tc.Name + ": " + tc.Status})
		}
	}
	if text != "" {
		out = append(out, Update{Kind: UpdMessage, ID: e.SessionID, Role: "assistant", Text: text})
	}
	if e.Usage != nil {
		var in, outTok, cache int64
		if e.Usage.InputTokens != nil {
			in = *e.Usage.InputTokens
		}
		if e.Usage.OutputTokens != nil {
			outTok = *e.Usage.OutputTokens
		}
		if e.Usage.CacheReadTokens != nil {
			cache = *e.Usage.CacheReadTokens
		}
		out = append(out, Update{Kind: UpdUsage, InTokens: in, OutTokens: outTok, CacheTokens: cache})
	}
	success := e.Error == "" && e.ExitCode == 0
	if e.Error != "" {
		out = append(out, Update{Kind: UpdIssue, Level: "error", Text: e.Error})
	}
	out = append(out, Update{Kind: UpdTurnDone, Success: success, Text: text})
	return out
}


