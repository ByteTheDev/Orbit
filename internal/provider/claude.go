package provider

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"path/filepath"
	"strings"

	"orbit/internal/model"
)

// Claude adapts the Claude Code CLI in headless mode:
//
//	claude -p --output-format stream-json --verbose --include-partial-messages
//
// The prompt is sent on stdin. Sessions are continued with --session-id (first
// turn) and --resume (later turns), which are documented Claude Code flags.
type Claude struct{}

func (Claude) ID() string   { return "claude" }
func (Claude) Name() string { return "Claude Code" }

func (Claude) Detect() Detection {
	p, ok := lookPath("claude")
	if !ok {
		return Detection{Hint: "Install Claude Code, then run `claude` once to sign in."}
	}
	return Detection{Available: true, Path: p}
}

func (Claude) Capabilities() model.Capabilities {
	return model.Capabilities{
		Stop:      true,
		Resume:    true,
		Send:      true,
		Cost:      true,
		Streaming: true,
		PermissionModes: []model.PermissionMode{
			{ID: "acceptEdits", Label: "Auto-accept edits", Description: "Edits files without asking. Shell commands still need approval."},
			{ID: "plan", Label: "Plan only", Description: "Reads and plans, never changes files."},
			{ID: "default", Label: "Ask first", Description: "Unapproved tools are denied in headless mode and reported as waiting."},
		},
		Models: claudeModels,
	}
}

// Run executes one turn of a Claude Code session.
func (c Claude) Run(ctx context.Context, spec Spec, emit func(Update)) error {
	d := c.Detect()
	if !d.Available {
		return errors.New("Claude Code is not installed or not on PATH")
	}
	args := []string{"-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages"}
	if spec.SessionID != "" {
		if spec.Resume {
			args = append(args, "--resume", spec.SessionID)
		} else {
			args = append(args, "--session-id", spec.SessionID)
		}
	}
	mode := spec.PermissionMode
	if mode == "" {
		mode = "acceptEdits"
	}
	args = append(args, "--permission-mode", mode)
	if spec.Model != "" {
		args = append(args, "--model", spec.Model)
	}
	parser := newClaudeParser()
	return runProcess(ctx, procSpec{Bin: d.Path, Args: args, Dir: spec.RepoPath, Stdin: spec.Prompt}, parser.parse, emit)
}

// ---- wire format ----------------------------------------------------------

type claudeEnvelope struct {
	Type           string          `json:"type"`
	Subtype        string          `json:"subtype"`
	SessionID      string          `json:"session_id"`
	APIMessageID   string          `json:"api_message_id"`
	Model          string          `json:"model"`
	Event          json.RawMessage `json:"event"`
	Message        json.RawMessage `json:"message"`
	IsError        bool            `json:"is_error"`
	Result         json.RawMessage `json:"result"`
	Errors         json.RawMessage `json:"errors"`
	TotalCostUSD   float64         `json:"total_cost_usd"`
	Usage          *claudeUsage    `json:"usage"`
	PermissionDeny []claudeDenial  `json:"permission_denials"`
}

type claudeUsage struct {
	InputTokens          int64 `json:"input_tokens"`
	OutputTokens         int64 `json:"output_tokens"`
	CacheReadInputTokens int64 `json:"cache_read_input_tokens"`
}

type claudeDenial struct {
	ToolName  string          `json:"tool_name"`
	ToolInput json.RawMessage `json:"tool_input"`
}

type claudeMessage struct {
	ID      string        `json:"id"`
	Content []claudeBlock `json:"content"`
}

type claudeBlock struct {
	Type      string          `json:"type"`
	Text      string          `json:"text"`
	ID        string          `json:"id"`
	Name      string          `json:"name"`
	Input     json.RawMessage `json:"input"`
	ToolUseID string          `json:"tool_use_id"`
	Content   json.RawMessage `json:"content"`
	IsError   bool            `json:"is_error"`
}

type claudeStreamEvent struct {
	Type         string       `json:"type"`
	Index        int          `json:"index"`
	ContentBlock *claudeBlock `json:"content_block"`
	Delta        struct {
		Type string `json:"type"`
		Text string `json:"text"`
	} `json:"delta"`
}

// claudeToolInfo remembers a tool_use so its result can be matched.
type claudeToolInfo struct {
	name string
	path string
	op   string
}

type claudeParser struct {
	tools       map[string]claudeToolInfo
	streamed    map[string]bool // stream message id (api id + block index) -> started
	streamedMsg map[string]bool // api message id -> has streamed text
}

func newClaudeParser() *claudeParser {
	return &claudeParser{
		tools:       map[string]claudeToolInfo{},
		streamed:    map[string]bool{},
		streamedMsg: map[string]bool{},
	}
}

func (p *claudeParser) parse(line []byte) []Update {
	var env claudeEnvelope
	if err := json.Unmarshal(line, &env); err != nil {
		return nil
	}
	switch env.Type {
	case "system":
		return p.system(env)
	case "stream_event":
		return p.stream(env)
	case "assistant":
		return p.assistant(env)
	case "user":
		return p.user(env)
	case "result":
		return p.result(env)
	}
	return nil
}

func (p *claudeParser) system(env claudeEnvelope) []Update {
	switch env.Subtype {
	case "init":
		return []Update{
			{Kind: UpdSession, ID: env.SessionID, Text: env.Model},
			{Kind: UpdActivity, Text: "Session ready on " + env.Model},
		}
	case "api_retry":
		return []Update{{Kind: UpdIssue, Level: "warning", Text: "The API request failed and is being retried."}}
	}
	return nil
}

func (p *claudeParser) stream(env claudeEnvelope) []Update {
	var ev claudeStreamEvent
	if err := json.Unmarshal(env.Event, &ev); err != nil {
		return nil
	}
	id := fmt.Sprintf("%s#%d", env.APIMessageID, ev.Index)
	switch ev.Type {
	case "content_block_start":
		if ev.ContentBlock == nil {
			return nil
		}
		switch ev.ContentBlock.Type {
		case "text":
			p.streamed[id] = true
			p.streamedMsg[env.APIMessageID] = true
			return []Update{
				{Kind: UpdStatus, Status: model.StatusWriting, Detail: "Writing a reply"},
				{Kind: UpdMessageStart, ID: id, Role: "assistant", Text: ev.ContentBlock.Text},
			}
		case "thinking":
			return []Update{{Kind: UpdStatus, Status: model.StatusThinking, Detail: "Thinking"}}
		}
	case "content_block_delta":
		if ev.Delta.Type == "text_delta" && ev.Delta.Text != "" {
			return []Update{{Kind: UpdMessageDelta, ID: id, Text: ev.Delta.Text}}
		}
	case "content_block_stop":
		if p.streamed[id] {
			return []Update{{Kind: UpdMessageEnd, ID: id}}
		}
	}
	return nil
}

func (p *claudeParser) assistant(env claudeEnvelope) []Update {
	var msg claudeMessage
	if err := json.Unmarshal(env.Message, &msg); err != nil {
		return nil
	}
	var out []Update
	for i, b := range msg.Content {
		switch b.Type {
		case "text":
			// Text already streamed for this API message is not repeated.
			id := fmt.Sprintf("%s#%d", msg.ID, i)
			if !p.streamedMsg[msg.ID] && strings.TrimSpace(b.Text) != "" {
				out = append(out, Update{Kind: UpdMessage, ID: id, Role: "assistant", Text: b.Text})
			}
		case "tool_use":
			out = append(out, p.toolUse(b)...)
		}
	}
	return out
}

func (p *claudeParser) toolUse(b claudeBlock) []Update {
	input := map[string]any{}
	_ = json.Unmarshal(b.Input, &input)
	tool := model.ToolCall{
		ID:      b.ID,
		Name:    b.Name,
		Summary: claudeSummary(b.Name, input),
		Input:   model.Truncate(string(b.Input), model.MaxToolIO),
		Status:  "running",
	}
	status, detail := claudeStatus(b.Name, input)
	out := []Update{
		{Kind: UpdStatus, Status: status, Detail: detail},
		{Kind: UpdToolStart, Tool: &tool},
	}
	if path, op, diff, ok := claudeFileTouch(b.Name, input); ok {
		p.tools[b.ID] = claudeToolInfo{name: b.Name, path: path, op: op}
		out = append(out, Update{Kind: UpdFile, File: &FileTouch{Path: path, Op: op, Tool: b.Name, Diff: diff, Phase: "start"}})
	}
	return out
}

func (p *claudeParser) user(env claudeEnvelope) []Update {
	var msg claudeMessage
	if err := json.Unmarshal(env.Message, &msg); err != nil {
		return nil
	}
	var out []Update
	for _, b := range msg.Content {
		if b.Type != "tool_result" {
			continue
		}
		out = append(out, Update{Kind: UpdToolEnd, ToolID: b.ToolUseID, Output: claudeText(b.Content), Failed: b.IsError})
		if info, ok := p.tools[b.ToolUseID]; ok {
			delete(p.tools, b.ToolUseID)
			out = append(out, Update{Kind: UpdFile, File: &FileTouch{Path: info.path, Op: info.op, Tool: info.name, Phase: "end"}})
		}
	}
	return out
}

func (p *claudeParser) result(env claudeEnvelope) []Update {
	var out []Update
	if env.Usage != nil {
		out = append(out, Update{
			Kind:        UpdUsage,
			InTokens:    env.Usage.InputTokens,
			OutTokens:   env.Usage.OutputTokens,
			CacheTokens: env.Usage.CacheReadInputTokens,
		})
	}
	if env.TotalCostUSD > 0 {
		out = append(out, Update{Kind: UpdCost, Cost: env.TotalCostUSD})
	}
	for _, d := range env.PermissionDeny {
		input := map[string]any{}
		_ = json.Unmarshal(d.ToolInput, &input)
		out = append(out, Update{Kind: UpdIssue, Level: "warning", Text: fmt.Sprintf("Permission needed for %s: %s", d.ToolName, claudeSummary(d.ToolName, input))})
	}
	if len(env.PermissionDeny) > 0 {
		out = append(out, Update{Kind: UpdStatus, Status: model.StatusWaiting, Detail: "Waiting for permission to run " + env.PermissionDeny[0].ToolName})
	}
	success := !env.IsError && env.Subtype == "success"
	text := claudeText(env.Result)
	if text == "" {
		text = claudeText(env.Errors)
	}
	out = append(out, Update{Kind: UpdTurnDone, Success: success, Text: text})
	return out
}

// ---- helpers ----------------------------------------------------------------

// claudeText reads a JSON value that is either a string or an array of text blocks.
func claudeText(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	var s string
	if json.Unmarshal(raw, &s) == nil {
		return s
	}
	var blocks []struct {
		Text string `json:"text"`
	}
	if json.Unmarshal(raw, &blocks) == nil {
		var parts []string
		for _, b := range blocks {
			if b.Text != "" {
				parts = append(parts, b.Text)
			}
		}
		return strings.Join(parts, "\n")
	}
	var list []string
	if json.Unmarshal(raw, &list) == nil {
		return strings.Join(list, "\n")
	}
	return ""
}

func claudeStr(m map[string]any, key string) string {
	if v, ok := m[key].(string); ok {
		return v
	}
	return ""
}

func claudeSummary(name string, in map[string]any) string {
	switch name {
	case "Read", "Edit", "MultiEdit", "Write":
		return claudeStr(in, "file_path")
	case "NotebookEdit":
		return claudeStr(in, "notebook_path")
	case "Bash", "PowerShell":
		return claudeStr(in, "command")
	case "Grep", "Glob":
		return claudeStr(in, "pattern")
	case "WebFetch":
		return claudeStr(in, "url")
	case "WebSearch":
		return claudeStr(in, "query")
	case "Task":
		return claudeStr(in, "description")
	}
	return name
}

func claudeStatus(name string, in map[string]any) (model.Status, string) {
	switch name {
	case "Read":
		return model.StatusReading, "Reading " + filepath.Base(claudeStr(in, "file_path"))
	case "Edit", "MultiEdit", "Write", "NotebookEdit":
		return model.StatusWriting, "Editing " + filepath.Base(claudeSummary(name, in))
	case "Glob", "Grep", "LS", "WebFetch", "WebSearch":
		return model.StatusReading, "Searching"
	}
	return model.StatusThinking, "Running " + name
}

// claudeFileTouch maps a file-related tool call to a path, operation and diff.
func claudeFileTouch(name string, in map[string]any) (path, op, diff string, ok bool) {
	switch name {
	case "Read":
		path = claudeStr(in, "file_path")
		return path, "read", "", path != ""
	case "Edit":
		path = claudeStr(in, "file_path")
		diff = unifiedLines(claudeStr(in, "old_string"), claudeStr(in, "new_string"))
		return path, "write", diff, path != ""
	case "MultiEdit":
		path = claudeStr(in, "file_path")
		var parts []string
		if edits, isList := in["edits"].([]any); isList {
			for _, e := range edits {
				if em, isMap := e.(map[string]any); isMap {
					parts = append(parts, unifiedLines(claudeStr(em, "old_string"), claudeStr(em, "new_string")))
				}
			}
		}
		return path, "write", strings.Join(parts, "\n"), path != ""
	case "Write":
		path = claudeStr(in, "file_path")
		return path, "write", unifiedLines("", claudeStr(in, "content")), path != ""
	case "NotebookEdit":
		path = claudeStr(in, "notebook_path")
		return path, "write", unifiedLines("", claudeStr(in, "new_source")), path != ""
	}
	return "", "", "", false
}

// unifiedLines renders an old/new replacement as a minimal diff for display.
func unifiedLines(oldText, newText string) string {
	var b strings.Builder
	for _, l := range strings.Split(oldText, "\n") {
		if oldText != "" {
			b.WriteString("- " + l + "\n")
		}
	}
	for _, l := range strings.Split(newText, "\n") {
		if newText != "" {
			b.WriteString("+ " + l + "\n")
		}
	}
	return model.Truncate(b.String(), model.MaxDiffBytes)
}
