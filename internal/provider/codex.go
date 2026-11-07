package provider

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"orbit/internal/browser"
	"orbit/internal/model"
)

// Codex adapts the OpenAI Codex CLI in non-interactive mode:
//
//	codex exec --json --skip-git-repo-check -s <sandbox> -     (first turn, prompt on stdin)
//	codex exec resume --json <thread-id> -                     (later turns)
//
// Event names (thread.started, turn.*, item.*) were checked against the installed
// binary. Item field names follow the documented exec JSON output.
type Codex struct{}

func (Codex) ID() string   { return "codex" }
func (Codex) Name() string { return "Codex" }

func (Codex) Detect() Detection {
	p, ok := lookPath("codex")
	if !ok {
		return Detection{Hint: "Install the Codex CLI and sign in with `codex login`."}
	}
	return Detection{Available: true, Path: p}
}

func (Codex) Capabilities() model.Capabilities {
	return model.Capabilities{
		Stop:      true,
		Resume:    true,
		Send:      true,
		Cost:      false, // Codex reports tokens, not dollars
		Streaming: false, // item-level events, not token deltas
		PermissionModes: []model.PermissionMode{
			{ID: "workspace-write", Label: "Workspace write", Description: "Can edit files inside the repository."},
			{ID: "read-only", Label: "Read only", Description: "Can read the repository but not change it."},
			{ID: "danger-full-access", Label: "Full access", Description: "No sandbox. Can edit files and run any command, including outside the repository."},
		},
		Models: codexModels,
	}
}

// Run executes one turn of a Codex session.
func (c Codex) Run(ctx context.Context, spec Spec, emit func(Update)) error {
	d := c.Detect()
	if !d.Available {
		return errors.New("Codex CLI is not installed or not on PATH")
	}
	parser := &codexParser{}
	return runProcess(ctx, procSpec{Bin: d.Path, Args: codexArgs(spec), Dir: spec.RepoPath, Stdin: spec.Prompt}, parser.parse, emit)
}

// codexArgs builds the Codex command line for one turn.
func codexArgs(spec Spec) []string {
	if spec.Resume && spec.SessionID != "" {
		args := []string{"exec", "resume", "--json", "--skip-git-repo-check"}
		if spec.Model != "" {
			args = append(args, "-m", spec.Model)
		}
		args = appendCodexEffort(appendCodexFast(args, spec), spec)
		args = appendCodexImages(appendCodexBrowser(args, spec), spec)
		return append(args, spec.SessionID, "-")
	}
	sandbox := spec.PermissionMode
	if sandbox == "" {
		sandbox = "workspace-write"
	}
	args := []string{"exec", "--json", "--skip-git-repo-check", "-s", sandbox}
	if spec.Model != "" {
		args = append(args, "-m", spec.Model)
	}
	args = appendCodexEffort(appendCodexFast(args, spec), spec)
	args = appendCodexImages(appendCodexBrowser(args, spec), spec)
	return append(args, "-")
}

// appendCodexBrowser registers the Orbit browser as an MCP server for this run only. The values
// are TOML, so the command path is quoted and its backslashes escaped.
func appendCodexBrowser(args []string, spec Spec) []string {
	if spec.BrowserCommand == "" {
		return args
	}
	args = append(args, "-c", "mcp_servers."+browserServerName+".command="+tomlString(spec.BrowserCommand))
	return append(args, "-c", "mcp_servers."+browserServerName+`.args=["`+browser.MCPFlag+`"]`)
}

// tomlString quotes s as a TOML basic string.
func tomlString(s string) string {
	return `"` + strings.NewReplacer(`\`, `\\`, `"`, `\"`).Replace(s) + `"`
}

// appendCodexImages attaches each image with its own --image=<path> flag. The = form keeps a
// path from being read as the prompt marker "-" that follows.
func appendCodexImages(args []string, spec Spec) []string {
	for _, img := range spec.Images {
		args = append(args, "--image="+img.Path)
	}
	return args
}

// appendCodexEffort sets the reasoning effort for this run. The value is TOML, hence the quotes.
func appendCodexEffort(args []string, spec Spec) []string {
	if spec.Effort != "" {
		args = append(args, "-c", `model_reasoning_effort="`+spec.Effort+`"`)
	}
	return args
}

// appendCodexFast asks Codex for its fast service tier on this turn only. It is a
// per-run config override, so the user's config.toml is not changed.
func appendCodexFast(args []string, spec Spec) []string {
	if spec.FastMode {
		args = append(args, "-c", `service_tier="fast"`)
	}
	return args
}

// ---- wire format ----------------------------------------------------------

type codexEvent struct {
	Type     string          `json:"type"`
	ThreadID string          `json:"thread_id"`
	Message  string          `json:"message"`
	Error    json.RawMessage `json:"error"`
	Usage    *struct {
		InputTokens       int64 `json:"input_tokens"`
		CachedInputTokens int64 `json:"cached_input_tokens"`
		OutputTokens      int64 `json:"output_tokens"`
	} `json:"usage"`
	Item *codexItem `json:"item"`
}

type codexItem struct {
	ID               string `json:"id"`
	Type             string `json:"type"`
	Text             string `json:"text"`
	Command          string `json:"command"`
	AggregatedOutput string `json:"aggregated_output"`
	ExitCode         *int   `json:"exit_code"`
	Status           string `json:"status"`
	Server           string `json:"server"`
	Tool             string `json:"tool"`
	Query            string `json:"query"`
	Message          string `json:"message"`
	Changes          []struct {
		Path string `json:"path"`
		Kind string `json:"kind"`
	} `json:"changes"`
	// Collaboration (sub-agent) items: Tool is spawn_agent, send_input, wait or close_agent.
	Prompt            string   `json:"prompt"`
	ReceiverThreadIDs []string `json:"receiver_thread_ids"`
	AgentsStates      map[string]struct {
		Status  string `json:"status"`
		Message string `json:"message"`
	} `json:"agents_states"`
}

type codexParser struct{}

func (p *codexParser) parse(line []byte) []Update {
	var ev codexEvent
	if err := json.Unmarshal(line, &ev); err != nil {
		return nil
	}
	switch ev.Type {
	case "thread.started":
		return []Update{{Kind: UpdSession, ID: ev.ThreadID}}
	case "turn.started":
		return []Update{{Kind: UpdStatus, Status: model.StatusThinking, Detail: "Working on the task"}}
	case "turn.completed":
		var out []Update
		if ev.Usage != nil {
			out = append(out, Update{
				Kind:        UpdUsage,
				InTokens:    ev.Usage.InputTokens,
				OutTokens:   ev.Usage.OutputTokens,
				CacheTokens: ev.Usage.CachedInputTokens,
			})
		}
		return append(out, Update{Kind: UpdTurnDone, Success: true})
	case "turn.failed":
		msg := codexErrorText(ev.Error)
		if msg == "" {
			msg = "The turn failed."
		}
		return []Update{
			{Kind: UpdIssue, Level: "error", Text: msg},
			{Kind: UpdTurnDone, Success: false, Text: msg},
		}
	case "error":
		level := "error"
		if strings.HasPrefix(ev.Message, "Reconnecting") {
			level = "warning"
		}
		return []Update{{Kind: UpdIssue, Level: level, Text: ev.Message}}
	case "item.started", "item.updated", "item.completed":
		if ev.Item == nil {
			return nil
		}
		return p.item(ev.Type, ev.Item)
	}
	return nil
}

func (p *codexParser) item(eventType string, it *codexItem) []Update {
	completed := eventType == "item.completed"
	switch it.Type {
	case "agent_message":
		if completed && strings.TrimSpace(it.Text) != "" {
			return []Update{
				{Kind: UpdStatus, Status: model.StatusWriting, Detail: "Writing a reply"},
				{Kind: UpdMessage, ID: it.ID, Role: "assistant", Text: it.Text},
			}
		}
	case "reasoning":
		if !completed {
			return []Update{{Kind: UpdStatus, Status: model.StatusThinking, Detail: "Thinking"}}
		}
	case "command_execution":
		if !completed {
			return []Update{
				{Kind: UpdStatus, Status: model.StatusThinking, Detail: "Running " + firstWords(it.Command, 6)},
				{Kind: UpdToolStart, Tool: &model.ToolCall{
					ID:      it.ID,
					Name:    "Shell",
					Summary: it.Command,
					Input:   model.Truncate(it.Command, model.MaxToolIO),
					Status:  "running",
				}},
			}
		}
		failed := it.Status == "failed" || (it.ExitCode != nil && *it.ExitCode != 0)
		return []Update{{Kind: UpdToolEnd, ToolID: it.ID, Output: it.AggregatedOutput, Failed: failed}}
	case "file_change":
		if !completed {
			return nil
		}
		var out []Update
		for _, c := range it.Changes {
			if c.Path == "" {
				continue
			}
			out = append(out,
				Update{Kind: UpdStatus, Status: model.StatusWriting, Detail: "Editing " + c.Path},
				Update{Kind: UpdFile, File: &FileTouch{Path: c.Path, Op: "write", Tool: "apply_patch", Phase: "start"}},
				Update{Kind: UpdFile, File: &FileTouch{Path: c.Path, Op: "write", Tool: "apply_patch", Phase: "end"}},
			)
		}
		return out
	case "mcp_tool_call":
		name := strings.Trim(it.Server+"."+it.Tool, ".")
		if !completed {
			return []Update{
				{Kind: UpdStatus, Status: model.StatusThinking, Detail: "Calling " + name},
				{Kind: UpdToolStart, Tool: &model.ToolCall{ID: it.ID, Name: name, Summary: name, Status: "running"}},
			}
		}
		return []Update{{Kind: UpdToolEnd, ToolID: it.ID, Output: it.Text, Failed: it.Status == "failed"}}
	case "web_search":
		if !completed {
			return []Update{
				{Kind: UpdStatus, Status: model.StatusReading, Detail: "Searching the web"},
				{Kind: UpdToolStart, Tool: &model.ToolCall{ID: it.ID, Name: "WebSearch", Summary: it.Query, Status: "running"}},
			}
		}
		return []Update{{Kind: UpdToolEnd, ToolID: it.ID, Output: "Search finished"}}
	case "collab_tool_call", "collab_agent_tool_call":
		return codexCollab(completed, it)
	case "error":
		if completed && it.Message != "" {
			return []Update{{Kind: UpdIssue, Level: "error", Text: it.Message}}
		}
	}
	return nil
}

// codexCollab turns Codex's multi-agent calls into sub-agent updates. A completed spawn_agent
// starts one sub-agent per child thread it created. Each child's reported state then updates it:
// pending or running is activity, completed ends it, and errored or not_found ends it as failed.
// The call's own tool rows are not shown, so the sub-agent icon is the only trace of it.
func codexCollab(completed bool, it *codexItem) []Update {
	var out []Update
	if it.Tool == "spawn_agent" && completed {
		text := firstWords(it.Prompt, 12)
		for _, id := range it.ReceiverThreadIDs {
			out = append(out, Update{Kind: UpdSubAgentStart, ID: id, Text: text, Detail: "agent"})
		}
	}
	for _, id := range it.ReceiverThreadIDs {
		st, ok := it.AgentsStates[id]
		if !ok {
			continue
		}
		switch st.Status {
		case "pending_init", "running":
			detail := "Working"
			if st.Message != "" {
				detail = st.Message
			}
			out = append(out, Update{Kind: UpdSubAgentActivity, ID: id, Detail: detail})
		case "completed", "interrupted", "shutdown":
			out = append(out, Update{Kind: UpdSubAgentEnd, ID: id})
		case "errored", "not_found":
			out = append(out, Update{Kind: UpdSubAgentEnd, ID: id, Failed: true})
		}
	}
	return out
}

func codexErrorText(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	var s string
	if json.Unmarshal(raw, &s) == nil {
		return s
	}
	var obj struct {
		Message string `json:"message"`
	}
	if json.Unmarshal(raw, &obj) == nil {
		return obj.Message
	}
	return fmt.Sprint(string(raw))
}

func firstWords(s string, n int) string {
	f := strings.Fields(s)
	if len(f) > n {
		f = append(f[:n], "…")
	}
	return strings.Join(f, " ")
}
