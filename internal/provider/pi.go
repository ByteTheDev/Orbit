package provider

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os/exec"
	"strings"
	"sync"
	"time"

	"orbit/internal/model"
)

// Pi adapts the Pi coding agent CLI in non-interactive mode:
//
//	pi --print --mode json
//
// The prompt is sent on stdin. Sessions are continued with --session <id>.
type Pi struct{}

func (Pi) ID() string   { return "pi" }
func (Pi) Name() string { return "Pi" }

func (Pi) Detect() Detection {
	p, ok := lookPath("pi")
	if !ok {
		return Detection{Hint: "Install Pi and configure a model."}
	}
	return Detection{Available: true, Path: p}
}

func (Pi) Capabilities() model.Capabilities {
	c := otherCaps(piModelList())
	return c
}

// Run executes one turn of a Pi session.
func (p Pi) Run(ctx context.Context, spec Spec, emit func(Update)) error {
	d := p.Detect()
	if !d.Available {
		return errors.New("Pi is not installed or not on PATH")
	}
	if len(spec.Images) != 0 {
		return errors.New("image attachments are not supported for Pi yet")
	}
	parser := &piParser{}
	return runProcess(ctx, procSpec{Bin: d.Path, Args: piArgs(spec), Dir: spec.RepoPath, Stdin: spec.Prompt}, parser.parse, emit)
}

// piArgs builds the Pi command line for one turn. The prompt is sent on stdin.
func piArgs(spec Spec) []string {
	args := []string{"--print", "--mode", "json"}
	if spec.Resume && spec.SessionID != "" {
		args = append(args, "--session", spec.SessionID)
	}
	if spec.Model != "" {
		args = append(args, "--model", spec.Model)
	}
	// Thinking does not persist across sessions, so it is sent on every turn.
	if spec.Effort != "" {
		args = append(args, "--thinking", spec.Effort)
	}
	return args
}

// ---- model discovery ---------------------------------------------------------

type piModelCache struct {
	mu   sync.Mutex
	at   time.Time
	data []model.ModelOption
}

var piModels piModelCache

func piModelList() []model.ModelOption {
	piModels.mu.Lock()
	defer piModels.mu.Unlock()
	if piModels.data != nil && time.Since(piModels.at) < modelCacheTTL {
		return piModels.data
	}
	list := fetchPiModels()
	piModels.data = list
	piModels.at = time.Now()
	return list
}

func fetchPiModels() []model.ModelOption {
	d := Pi{}.Detect()
	if !d.Available {
		return []model.ModelOption{}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, d.Path, "--list-models")
	out, err := cmd.Output()
	if err != nil {
		return []model.ModelOption{}
	}
	out2 := []model.ModelOption{}
	seen := map[string]bool{}
	for _, line := range strings.Split(string(out), "\n") {
		fields := strings.Fields(line)
		if len(fields) == 0 {
			continue
		}
		id := fields[0]
		if id == "" || seen[id] {
			continue
		}
		seen[id] = true
		group := id
		if i := strings.IndexByte(id, '/'); i >= 0 {
			group = id[:i]
		}
		out2 = append(out2, model.ModelOption{ID: id, Label: id, Group: group, Effort: []string{"off", "minimal", "low", "medium", "high", "xhigh"}, DefaultEffort: "medium"})
	}
	return out2
}

// ---- wire format -------------------------------------------------------------

type piParser struct {
	session string
	next    int
	prefix  string
}

func (p *piParser) parse(line []byte) []Update {
	var e struct {
		Type    string `json:"type"`
		ID      string `json:"id"`
		Message struct {
			Role         string `json:"role"`
			Content      []struct {
				Type string `json:"type"`
				Text string `json:"text"`
			} `json:"content"`
			ErrorMessage string `json:"errorMessage"`
		} `json:"message"`
	}
	if json.Unmarshal(line, &e) != nil {
		return nil
	}
	var out []Update
	if e.Type == "session" {
		id := e.ID
		if id == "" {
			// Some versions report the id under a different field; fall back.
		}
		if id != "" && p.session != id {
			p.session = id
			out = append(out, Update{Kind: UpdSession, ID: id})
		}
	}
	if e.Type == "message_end" && e.Message.Role == "assistant" {
		var parts []string
		for _, c := range e.Message.Content {
			if c.Type == "text" && c.Text != "" {
				parts = append(parts, c.Text)
			}
		}
		text := strings.Join(parts, "\n")
		if p.prefix == "" {
			p.prefix = fmt.Sprintf("pi-%d", time.Now().UnixNano())
		}
		if len(parts) > 0 {
			p.next++
			out = append(out, Update{Kind: UpdMessage, ID: fmt.Sprintf("%s-%d", p.prefix, p.next), Role: "assistant", Text: text})
		}
		success := e.Message.ErrorMessage == ""
		msg := text
		if e.Message.ErrorMessage != "" {
			msg = e.Message.ErrorMessage
		}
		out = append(out, Update{Kind: UpdTurnDone, Success: success, Text: msg})
	}
	return out
}


