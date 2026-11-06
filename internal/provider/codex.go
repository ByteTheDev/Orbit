package provider

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

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
	var args []string
	if spec.Resume && spec.SessionID != "" {
		args = []string{"exec", "resume", "--json", "--skip-git-repo-check"}
		if spec.Model != "" {
			args = append(args, "-m", spec.Model)
		}
		args = append(args, spec.SessionID, "-")
	} else {
		sandbox := spec.PermissionMode
		if sandbox == "" {
			sandbox = "workspace-write"
		}
		args = []string{"exec", "--json", "--skip-git-repo-check", "-s", sandbox}
		if spec.Model != "" {
			args = append(args, "-m", spec.Model)
		}
		args = append(args, "-")
	}
	parser := &codexParser{}
	return runProcess(ctx, procSpec{Bin: d.Path, Args: args, Dir: spec.RepoPath, Stdin: spec.Prompt}, parser.parse, emit)
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
	case "error":
		if completed && it.Message != "" {
			return []Update{{Kind: UpdIssue, Level: "error", Text: it.Message}}
		}
	}
	return nil
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
