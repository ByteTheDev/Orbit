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

// OMP and OpenCode use their own configured default model and credentials.
type OMP struct{}
type OpenCode struct{}

func (OMP) ID() string        { return "omp" }
func (OMP) Name() string      { return "Oh My Pi" }
func (OpenCode) ID() string   { return "opencode" }
func (OpenCode) Name() string { return "OpenCode" }
func detectOther(name, hint string) Detection {
	p, ok := lookPath(name)
	return Detection{Available: ok, Path: p, Hint: hint}
}
func (OMP) Detect() Detection { return detectOther("omp", "Install Oh My Pi and configure a model.") }
func (OpenCode) Detect() Detection {
	return detectOther("opencode", "Install OpenCode and configure a model.")
}

// otherCaps is the static part of both providers' capabilities. The model list is
// fetched from the CLI separately, so it can change without rebuilding Orbit.
func otherCaps(models []model.ModelOption) model.Capabilities {
	if models == nil {
		models = []model.ModelOption{}
	}
	return model.Capabilities{Stop: true, Resume: true, Send: true, PermissionModes: []model.PermissionMode{}, Models: models}
}

func (p OMP) Capabilities() model.Capabilities {
	return otherCaps(ompModelList())
}
func (p OpenCode) Capabilities() model.Capabilities {
	return otherCaps(openCodeModelList())
}

// ---- model discovery ---------------------------------------------------------

// modelCache holds a CLI's model list plus the time it was fetched.
type modelCache struct {
	mu   sync.Mutex
	at   time.Time
	data []model.ModelOption
}

const modelCacheTTL = 5 * time.Minute

var (
	ompModels      modelCache
	openCodeModels modelCache
)

// ompModelList returns the models Oh My Pi currently offers, cached for a few minutes.
func ompModelList() []model.ModelOption {
	ompModels.mu.Lock()
	defer ompModels.mu.Unlock()
	if ompModels.data != nil && time.Since(ompModels.at) < modelCacheTTL {
		return ompModels.data
	}
	list := fetchOMPModels()
	ompModels.data = list
	ompModels.at = time.Now()
	return list
}

// openCodeModelList returns the models OpenCode currently offers, cached for a few minutes.
func openCodeModelList() []model.ModelOption {
	openCodeModels.mu.Lock()
	defer openCodeModels.mu.Unlock()
	if openCodeModels.data != nil && time.Since(openCodeModels.at) < modelCacheTTL {
		return openCodeModels.data
	}
	list := fetchOpenCodeModels()
	openCodeModels.data = list
	openCodeModels.at = time.Now()
	return list
}

func fetchOMPModels() []model.ModelOption {
	d := OMP{}.Detect()
	if !d.Available {
		return []model.ModelOption{}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, d.Path, "models", "--json")
	out, err := cmd.Output()
	if err != nil {
		return []model.ModelOption{}
	}
	var payload struct {
		Models []struct {
			Provider string   `json:"provider"`
			ID       string   `json:"id"`
			Selector string   `json:"selector"`
			Name     string   `json:"name"`
			Thinking []string `json:"thinking"`
		} `json:"models"`
	}
	if err := json.Unmarshal(out, &payload); err != nil {
		return []model.ModelOption{}
	}
	out2 := make([]model.ModelOption, 0, len(payload.Models))
	for _, m := range payload.Models {
		id := m.Selector
		if id == "" {
			id = m.ID
		}
		if m.Provider != "" && !strings.Contains(id, "/") {
			id = m.Provider + "/" + id
		}
		label := m.Name
		if label == "" {
			label = id
		}
		out2 = append(out2, model.ModelOption{
			ID:      id,
			Label:   label,
			Group:   m.Provider,
			Effort:  m.Thinking,
		})
	}
	return out2
}

func fetchOpenCodeModels() []model.ModelOption {
	d := OpenCode{}.Detect()
	if !d.Available {
		return []model.ModelOption{}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, d.Path, "models")
	out, err := cmd.Output()
	if err != nil {
		return []model.ModelOption{}
	}
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

func (p OMP) Run(ctx context.Context, spec Spec, emit func(Update)) error {
	d := p.Detect()
	if !d.Available {
		return errors.New("Oh My Pi is not installed or not on PATH")
	}
	if len(spec.Images) != 0 {
		return errors.New("image attachments are not supported for Oh My Pi yet")
	}
	args := []string{"--print", "--mode", "json"}
	if spec.Resume && spec.SessionID != "" {
		args = append(args, "--resume", spec.SessionID)
	}
	if spec.Model != "" {
		args = append(args, "--model", spec.Model)
	}
	parser := &ompParser{prefix: fmt.Sprintf("omp-%d", time.Now().UnixNano())}
	return runProcess(ctx, procSpec{Bin: d.Path, Args: args, Dir: spec.RepoPath, Stdin: spec.Prompt}, parser.parse, emit)
}
func (p OpenCode) Run(ctx context.Context, spec Spec, emit func(Update)) error {
	d := p.Detect()
	if !d.Available {
		return errors.New("OpenCode is not installed or not on PATH")
	}
	args := []string{"run", "--format", "json"}
	if spec.Resume && spec.SessionID != "" {
		args = append(args, "--session", spec.SessionID)
	}
	if spec.Model != "" {
		args = append(args, "--model", spec.Model)
	}
	for _, img := range spec.Images {
		args = append(args, "--file", img.Path)
	}
	args = append(args, "--", spec.Prompt)
	parser := &openCodeParser{}
	return runProcess(ctx, procSpec{Bin: d.Path, Args: args, Dir: spec.RepoPath}, parser.parse, emit)
}

type ompParser struct {
	next   int
	prefix string
}

func (p *ompParser) parse(line []byte) []Update {
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
	switch e.Type {
	case "session":
		return []Update{{Kind: UpdSession, ID: e.ID}}
	case "message_end":
		if e.Message.Role != "assistant" {
			return nil
		}
		if e.Message.ErrorMessage != "" {
			return []Update{{Kind: UpdTurnDone, Success: false, Text: e.Message.ErrorMessage}}
		}
		var parts []string
		for _, c := range e.Message.Content {
			if c.Type == "text" && c.Text != "" {
				parts = append(parts, c.Text)
			}
		}
		text := strings.Join(parts, "\n")
		out := []Update{}
		if len(parts) > 0 {
			p.next++
			out = append(out, Update{Kind: UpdMessage, ID: fmt.Sprintf("%s-%d", p.prefix, p.next), Role: "assistant", Text: text})
		}
		out = append(out, Update{Kind: UpdTurnDone, Success: true, Text: text})
		return out
	}
	return nil
}

type openCodeParser struct{ session string }

func (p *openCodeParser) parse(line []byte) []Update {
	var e struct {
		Type    string          `json:"type"`
		Session string          `json:"sessionID"`
		Error   json.RawMessage `json:"error"`
		Part    struct {
			ID     string  `json:"id"`
			Text   string  `json:"text"`
			Cost   float64 `json:"cost"`
			Tokens struct {
				Input  int64 `json:"input"`
				Output int64 `json:"output"`
				Cache  struct {
					Read int64 `json:"read"`
				} `json:"cache"`
			} `json:"tokens"`
		} `json:"part"`
	}
	if json.Unmarshal(line, &e) != nil {
		return nil
	}
	var out []Update
	if e.Session != "" && p.session != e.Session {
		p.session = e.Session
		out = append(out, Update{Kind: UpdSession, ID: e.Session})
	}
	switch e.Type {
	case "text":
		out = append(out, Update{Kind: UpdMessage, ID: e.Part.ID, Role: "assistant", Text: e.Part.Text})
	case "step_finish":
		out = append(out, Update{Kind: UpdUsage, InTokens: e.Part.Tokens.Input, OutTokens: e.Part.Tokens.Output, CacheTokens: e.Part.Tokens.Cache.Read}, Update{Kind: UpdCost, Cost: e.Part.Cost}, Update{Kind: UpdTurnDone, Success: true})
	case "error":
		out = append(out, Update{Kind: UpdTurnDone, Success: false, Text: string(e.Error)})
	}
	return out
}