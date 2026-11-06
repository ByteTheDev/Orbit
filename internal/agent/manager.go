// Package agent owns the state of every project and agent, runs their turns,
// and turns provider updates into batched events for the UI.
//
// Events are queued and flushed at most every flushDelay, so a fast stream of
// text deltas costs one IPC message instead of hundreds. Nothing polls: the
// flush timer exists only while there is something to send.
package agent

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"orbit/internal/conflict"
	"orbit/internal/model"
	"orbit/internal/provider"
	"orbit/internal/store"
)

const flushDelay = 60 * time.Millisecond

// maxRecentFiles bounds the file list sent with every agent summary.
const maxRecentFiles = 10

// Errors returned to the UI. The messages are shown to the user as-is.
var (
	ErrNotFound = errors.New("that agent no longer exists")
	ErrBusy     = errors.New("this agent is already working")
	ErrIdle     = errors.New("this agent is not running")
)

type run struct {
	cancel        context.CancelFunc
	stopRequested bool
	done          bool
	success       bool
	text          string
}

// Manager is safe for concurrent use. All state lives behind mu.
type Manager struct {
	mu            sync.Mutex
	projects      map[string]*model.Project
	agents        map[string]*model.AgentRecord
	runs          map[string]*run
	providers     map[string]provider.Provider
	dirtyAgents   map[string]bool
	dirtyProjects map[string]bool
	pending       []model.Event
	flushTimer    *time.Timer
	flushMu       sync.Mutex
	emit          func([]model.Event)
	onChange      func()
	seq           int64
	iconDir       string
}

// New creates an empty manager. emit receives each flushed batch; onChange is
// called whenever persisted state changes and must not block.
func New(emit func([]model.Event), onChange func()) *Manager {
	return &Manager{
		projects:      map[string]*model.Project{},
		agents:        map[string]*model.AgentRecord{},
		runs:          map[string]*run{},
		providers:     provider.Registry(),
		dirtyAgents:   map[string]bool{},
		dirtyProjects: map[string]bool{},
		emit:          emit,
		onChange:      onChange,
	}
}

// Load restores persisted state. Agents that were running when Orbit closed
// have no process any more, so they are marked stopped.
func (m *Manager) Load(st store.State) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for i := range st.Projects {
		p := st.Projects[i]
		m.projects[p.ID] = &p
	}
	for i := range st.Agents {
		rec := st.Agents[i]
		if rec.Files == nil {
			rec.Files = map[string]*model.FileActivity{}
		}
		if rec.Running || rec.Status == model.StatusThinking || rec.Status == model.StatusWriting ||
			rec.Status == model.StatusReading || rec.Status == model.StatusWaiting {
			rec.Running = false
			rec.Status = model.StatusStopped
			rec.StatusDetail = "Interrupted when Orbit closed"
		}
		if rec.Seq > m.seq {
			m.seq = rec.Seq
		}
		m.agents[rec.ID] = &rec
	}
}

// Persist calls fn with the current state while holding the lock, so the
// caller can serialise it without racing with running agents.
func (m *Manager) Persist(fn func(store.State) error) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	st := store.State{Version: store.Version}
	for _, p := range m.projects {
		st.Projects = append(st.Projects, *p)
	}
	for _, a := range m.agents {
		st.Agents = append(st.Agents, *a)
	}
	sort.Slice(st.Projects, func(i, j int) bool { return st.Projects[i].CreatedAt < st.Projects[j].CreatedAt })
	sort.Slice(st.Agents, func(i, j int) bool { return st.Agents[i].CreatedAt < st.Agents[j].CreatedAt })
	return fn(st)
}

// ---- queries --------------------------------------------------------------

// Projects returns every project with live counts and conflicts.
func (m *Manager) Projects() []model.ProjectSummary {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]model.ProjectSummary, 0, len(m.projects))
	for _, p := range m.projects {
		out = append(out, m.projectSummaryLocked(p))
	}
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt < out[j].CreatedAt })
	return out
}

// Agents returns summaries for every agent.
func (m *Manager) Agents() []model.AgentSummary {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]model.AgentSummary, 0, len(m.agents))
	for _, a := range m.agents {
		out = append(out, m.summaryLocked(a))
	}
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt < out[j].CreatedAt })
	return out
}

// Detail returns the full history of one agent.
func (m *Manager) Detail(id string) (model.AgentDetail, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	rec, ok := m.agents[id]
	if !ok {
		return model.AgentDetail{}, ErrNotFound
	}
	files := make([]model.FileActivity, 0, len(rec.Files))
	for _, f := range rec.Files {
		files = append(files, copyFile(f, true))
	}
	sort.Slice(files, func(i, j int) bool { return files[i].LastAt > files[j].LastAt })
	d := model.AgentDetail{
		AgentSummary: m.summaryLocked(rec),
		Messages:     cloneOrEmpty(rec.Messages),
		Tools:        cloneOrEmpty(rec.Tools),
		Activity:     cloneOrEmpty(rec.Activity),
		Issues:       cloneOrEmpty(rec.Issues),
		Files:        files,
	}
	return d, nil
}

// cloneOrEmpty copies a slice and never returns nil. A nil slice marshals to JSON null,
// and the frontend iterates these collections, so an empty history must arrive as [].
func cloneOrEmpty[T any](s []T) []T {
	out := make([]T, len(s))
	copy(out, s)
	return out
}

// ProjectPath returns the repository path of the agent's project.
func (m *Manager) ProjectPath(agentID string) (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	rec, ok := m.agents[agentID]
	if !ok {
		return "", ErrNotFound
	}
	p, ok := m.projects[rec.ProjectID]
	if !ok {
		return "", errors.New("the agent's project no longer exists")
	}
	return p.RepoPath, nil
}

// ---- projects -------------------------------------------------------------

// CreateProject registers a repository folder as a project.
func (m *Manager) CreateProject(name, repoPath string) (model.ProjectSummary, error) {
	repoPath = strings.TrimSpace(repoPath)
	if repoPath == "" {
		return model.ProjectSummary{}, errors.New("choose the repository folder first")
	}
	abs, err := filepath.Abs(repoPath)
	if err != nil {
		return model.ProjectSummary{}, fmt.Errorf("resolve folder: %w", err)
	}
	info, err := os.Stat(abs)
	if err != nil || !info.IsDir() {
		return model.ProjectSummary{}, errors.New("that folder does not exist")
	}
	name = strings.TrimSpace(name)
	if name == "" {
		name = filepath.Base(abs)
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	p := &model.Project{ID: newID(), Name: name, RepoPath: abs, CreatedAt: nowMs()}
	m.projects[p.ID] = p
	m.dirtyProjects[p.ID] = true
	m.scheduleFlushLocked()
	m.changedLocked()
	return m.projectSummaryLocked(p), nil
}

// SetProjectIcon sets the letter shown on a project's sun. An empty icon restores
// the default, the first letter of the project name.
func (m *Manager) SetProjectIcon(id, icon string) error {
	icon = strings.TrimSpace(icon)
	if n := utf8.RuneCountInString(icon); n > model.MaxIconRunes {
		return fmt.Errorf("the icon can be at most %d characters", model.MaxIconRunes)
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	p, ok := m.projects[id]
	if !ok {
		return errors.New("that project no longer exists")
	}
	p.Icon = icon
	// A letter and an uploaded image are exclusive: choosing a letter (or resetting) removes the image.
	m.clearIconLocked(p)
	m.dirtyProjects[id] = true
	m.scheduleFlushLocked()
	m.changedLocked()
	return nil
}

// DeleteProject stops and removes every agent in the project, then the project.
func (m *Manager) DeleteProject(id string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.projects[id]; !ok {
		return errors.New("that project no longer exists")
	}
	for agentID, rec := range m.agents {
		if rec.ProjectID == id {
			m.removeAgentLocked(agentID)
		}
	}
	m.clearIconLocked(m.projects[id])
	delete(m.projects, id)
	m.pending = append(m.pending, model.Event{Type: "projectRemoved", ID: id})
	m.scheduleFlushLocked()
	m.changedLocked()
	return nil
}

// ---- agents ---------------------------------------------------------------

// LaunchRequest is what the launch dialog sends.
type LaunchRequest struct {
	ProjectID      string `json:"projectId"`
	Name           string `json:"name"`
	Provider       string `json:"provider"`
	Model          string `json:"model"`
	PermissionMode string `json:"permissionMode"`
	Task           string `json:"task"`
}

// Launch creates an agent in a project and, when a task is given, starts its first turn.
func (m *Manager) Launch(req LaunchRequest) (model.AgentSummary, error) {
	prov, ok := m.providers[req.Provider]
	if !ok {
		return model.AgentSummary{}, fmt.Errorf("unknown provider %q", req.Provider)
	}
	if d := prov.Detect(); !d.Available {
		return model.AgentSummary{}, fmt.Errorf("%s is not available: %s", prov.Name(), d.Hint)
	}
	if req.Model != "" {
		// A provider with a model list only accepts models from it, so a bad id fails here, not in the CLI.
		if caps := prov.Capabilities(); len(caps.Models) > 0 && !caps.HasModel(req.Model) {
			return model.AgentSummary{}, fmt.Errorf("%s does not offer the model %q", prov.Name(), req.Model)
		}
	}

	m.mu.Lock()
	defer m.mu.Unlock()
	proj, ok := m.projects[req.ProjectID]
	if !ok {
		return model.AgentSummary{}, errors.New("choose a project first")
	}
	if info, err := os.Stat(proj.RepoPath); err != nil || !info.IsDir() {
		return model.AgentSummary{}, errors.New("the project's repository folder is missing")
	}

	mode := req.PermissionMode
	if mode == "" && len(prov.Capabilities().PermissionModes) > 0 {
		mode = prov.Capabilities().PermissionModes[0].ID
	}
	name := strings.TrimSpace(req.Name)
	if name == "" {
		name = fmt.Sprintf("%s %d", shortName(prov), m.countAgentsLocked(req.ProjectID)+1)
	}
	now := nowMs()
	rec := &model.AgentRecord{
		ID:             newID(),
		ProjectID:      proj.ID,
		Name:           name,
		Provider:       prov.ID(),
		Model:          strings.TrimSpace(req.Model),
		Task:           strings.TrimSpace(req.Task),
		PermissionMode: mode,
		Status:         model.StatusIdle,
		StatusDetail:   "Ready for a task",
		CreatedAt:      now,
		UpdatedAt:      now,
		Files:          map[string]*model.FileActivity{},
	}
	if prov.ID() == "claude" {
		// Claude Code accepts a session id chosen by the caller.
		rec.SessionID = newUUID()
	}
	m.agents[rec.ID] = rec
	m.markAgentLocked(rec.ID)
	m.changedLocked()

	if rec.Task != "" {
		if err := m.startTurnLocked(rec, rec.Task); err != nil {
			return m.summaryLocked(rec), err
		}
	}
	return m.summaryLocked(rec), nil
}

// Send starts a new turn with the given message.
func (m *Manager) Send(agentID, text string) error {
	text = strings.TrimSpace(text)
	if text == "" {
		return errors.New("type a message first")
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	rec, ok := m.agents[agentID]
	if !ok {
		return ErrNotFound
	}
	if !m.capsLocked(rec).Send {
		return errors.New("this provider does not accept messages")
	}
	return m.startTurnLocked(rec, text)
}

// Resume continues the last session with a nudge to pick the task back up.
func (m *Manager) Resume(agentID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	rec, ok := m.agents[agentID]
	if !ok {
		return ErrNotFound
	}
	if !m.capsLocked(rec).Resume {
		return errors.New("this provider cannot resume sessions")
	}
	if rec.Turns == 0 {
		return errors.New("this agent has not started yet; send it a task instead")
	}
	return m.startTurnLocked(rec, "Continue from where you stopped and finish the task.")
}

// Stop cancels the running turn. The provider process tree is killed.
func (m *Manager) Stop(agentID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	rec, ok := m.agents[agentID]
	if !ok {
		return ErrNotFound
	}
	if !m.capsLocked(rec).Stop {
		return errors.New("this provider cannot be stopped from Orbit")
	}
	r, running := m.runs[agentID]
	if !running || !rec.Running {
		return ErrIdle
	}
	r.stopRequested = true
	r.cancel()
	return nil
}

// Remove stops the agent if needed and deletes it.
func (m *Manager) Remove(agentID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.agents[agentID]; !ok {
		return ErrNotFound
	}
	m.removeAgentLocked(agentID)
	m.changedLocked()
	return nil
}

// ProjectRepo returns the repository folder of a project. Terminals open here, so the
// window never chooses a working directory itself.
func (m *Manager) ProjectRepo(projectID string) (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	proj, ok := m.projects[projectID]
	if !ok {
		return "", errors.New("choose a project first")
	}
	return proj.RepoPath, nil
}

// Rename changes an agent's display name. The name is trimmed and must be 1 to 60 characters.
func (m *Manager) Rename(agentID, name string) error {
	name = strings.TrimSpace(name)
	if name == "" {
		return errors.New("give the agent a name")
	}
	if len([]rune(name)) > 60 {
		return errors.New("names can be up to 60 characters")
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	rec, ok := m.agents[agentID]
	if !ok {
		return ErrNotFound
	}
	rec.Name = name
	m.markAgentLocked(agentID)
	m.changedLocked()
	return nil
}

// SetPosition records where the user placed an agent in the universe.
func (m *Manager) SetPosition(agentID string, x, y float64) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	rec, ok := m.agents[agentID]
	if !ok {
		return ErrNotFound
	}
	rec.Position = &model.Point{X: x, Y: y}
	m.markAgentLocked(agentID)
	m.changedLocked()
	return nil
}

// ---- turn lifecycle -------------------------------------------------------

func (m *Manager) startTurnLocked(rec *model.AgentRecord, prompt string) error {
	if rec.Running {
		return ErrBusy
	}
	prov, ok := m.providers[rec.Provider]
	if !ok {
		return fmt.Errorf("unknown provider %q", rec.Provider)
	}
	proj, ok := m.projects[rec.ProjectID]
	if !ok {
		return errors.New("the agent's project no longer exists")
	}
	ctx, cancel := context.WithCancel(context.Background())
	r := &run{cancel: cancel}
	m.runs[rec.ID] = r

	now := nowMs()
	rec.Running = true
	rec.Turns++
	rec.RunStartedAt = now
	rec.LastError = ""
	rec.Status = model.StatusThinking
	rec.StatusDetail = "Starting"
	rec.Messages = appendCapped(rec.Messages, model.Message{ID: newID(), Role: "user", Text: model.Truncate(prompt, model.MaxTextBytes), At: now}, model.MaxMessages)
	m.addActivityLocked(rec, "message", "You: "+firstLine(prompt, 90))
	m.markAgentLocked(rec.ID)
	m.changedLocked()

	spec := provider.Spec{
		AgentID:        rec.ID,
		RepoPath:       proj.RepoPath,
		Prompt:         prompt,
		SessionID:      rec.SessionID,
		Resume:         rec.SessionSeen && rec.SessionID != "",
		Model:          rec.Model,
		PermissionMode: rec.PermissionMode,
	}
	go m.runTurn(ctx, r, rec.ID, prov, spec)
	return nil
}

func (m *Manager) runTurn(ctx context.Context, r *run, id string, prov provider.Provider, spec provider.Spec) {
	err := prov.Run(ctx, spec, func(u provider.Update) {
		m.mu.Lock()
		defer m.mu.Unlock()
		if rec, ok := m.agents[id]; ok {
			m.applyLocked(rec, r, u)
		}
	})

	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.runs, id)
	rec, ok := m.agents[id]
	if !ok {
		return // removed while running
	}
	rec.Running = false
	rec.UpdatedAt = nowMs()
	switch {
	case r.stopRequested:
		m.setStatusLocked(rec, model.StatusStopped, "Stopped")
	case err != nil && !errors.Is(err, context.Canceled):
		m.addIssueLocked(rec, "error", err.Error())
		rec.LastError = err.Error()
		m.setStatusLocked(rec, model.StatusFailed, "The turn failed")
	case r.done && !r.success:
		rec.LastError = r.text
		m.setStatusLocked(rec, model.StatusFailed, "The turn failed")
	case rec.Status == model.StatusWaiting && r.done && r.success:
		// Stays waiting: the agent needs a permission decision.
	default:
		m.setStatusLocked(rec, model.StatusCompleted, "Turn complete")
	}
	m.markAgentLocked(id)
	m.changedLocked()
}

// applyLocked folds one provider update into the agent's state.
func (m *Manager) applyLocked(rec *model.AgentRecord, r *run, u provider.Update) {
	now := nowMs()
	switch u.Kind {
	case provider.UpdSession:
		if u.ID != "" {
			rec.SessionID = u.ID
			rec.SessionSeen = true
		}
		if rec.Model == "" && u.Text != "" {
			rec.Model = u.Text
		}
	case provider.UpdStatus:
		m.setStatusLocked(rec, u.Status, u.Detail)
	case provider.UpdMessageStart:
		m.upsertMessageLocked(rec, model.Message{ID: u.ID, Role: roleOr(u.Role), Text: u.Text, Streaming: true, At: now})
	case provider.UpdMessageDelta:
		idx := findMessage(rec.Messages, u.ID)
		if idx < 0 {
			m.upsertMessageLocked(rec, model.Message{ID: u.ID, Role: "assistant", Streaming: true, At: now})
			idx = len(rec.Messages) - 1
		}
		msg := &rec.Messages[idx]
		if len(msg.Text)+len(u.Text) <= model.MaxTextBytes {
			msg.Text += u.Text
		}
		m.pending = append(m.pending, model.Event{Type: "delta", AgentID: rec.ID, MessageID: u.ID, Text: u.Text})
		m.scheduleFlushLocked()
	case provider.UpdMessageEnd:
		if idx := findMessage(rec.Messages, u.ID); idx >= 0 {
			rec.Messages[idx].Streaming = false
			m.pending = append(m.pending, model.Event{Type: "messageEnd", AgentID: rec.ID, MessageID: u.ID})
			m.scheduleFlushLocked()
			m.addActivityLocked(rec, "message", "Agent replied: "+firstLine(rec.Messages[idx].Text, 90))
		}
	case provider.UpdMessage:
		m.upsertMessageLocked(rec, model.Message{ID: u.ID, Role: roleOr(u.Role), Text: model.Truncate(u.Text, model.MaxTextBytes), At: now})
		if roleOr(u.Role) == "assistant" {
			m.addActivityLocked(rec, "message", "Agent replied: "+firstLine(u.Text, 90))
		}
	case provider.UpdToolStart:
		if u.Tool != nil {
			t := *u.Tool
			t.At = now
			t.Input = model.Truncate(t.Input, model.MaxToolIO)
			rec.Tools = appendCapped(rec.Tools, t, model.MaxTools)
			rec.ToolCalls++
			m.addActivityLocked(rec, "tool", "Ran "+t.Name+": "+firstLine(t.Summary, 90))
			m.emitLocked(model.Event{Type: "tool", AgentID: rec.ID, Tool: &t})
		}
	case provider.UpdToolEnd:
		m.finishToolLocked(rec, u, now)
	case provider.UpdFile:
		if u.File != nil {
			m.touchFileLocked(rec, u.File, now)
		}
	case provider.UpdUsage:
		rec.Usage.InputTokens += u.InTokens
		rec.Usage.OutputTokens += u.OutTokens
		rec.Usage.CacheReadTokens += u.CacheTokens
	case provider.UpdCost:
		rec.Usage.CostUSD += u.Cost
	case provider.UpdIssue:
		m.addIssueLocked(rec, u.Level, u.Text)
	case provider.UpdActivity:
		m.addActivityLocked(rec, "system", u.Text)
	case provider.UpdTurnDone:
		r.done = true
		r.success = u.Success
		r.text = u.Text
		if u.Text != "" && u.Success {
			rec.StatusDetail = firstLine(u.Text, 120)
		}
	}
	rec.UpdatedAt = now
	m.markAgentLocked(rec.ID)
}

func (m *Manager) finishToolLocked(rec *model.AgentRecord, u provider.Update, now int64) {
	status := "ok"
	if u.Failed {
		status = "error"
	}
	output := model.Truncate(u.Output, model.MaxToolIO)
	var t model.ToolCall
	found := false
	for i := len(rec.Tools) - 1; i >= 0; i-- {
		if rec.Tools[i].ID == u.ToolID {
			rec.Tools[i].Output = output
			rec.Tools[i].Status = status
			t = rec.Tools[i]
			found = true
			break
		}
	}
	if !found {
		// A result arrived without a recorded start; keep it so nothing is lost.
		t = model.ToolCall{ID: u.ToolID, Name: "Tool", Output: output, Status: status, At: now}
		rec.Tools = appendCapped(rec.Tools, t, model.MaxTools)
		rec.ToolCalls++
	}
	if u.Failed {
		m.addIssueLocked(rec, "error", fmt.Sprintf("%s failed: %s", t.Name, firstLine(output, 140)))
		m.addActivityLocked(rec, "error", t.Name+" failed")
	} else {
		m.addActivityLocked(rec, "tool", t.Name+" finished")
	}
	m.emitLocked(model.Event{Type: "tool", AgentID: rec.ID, Tool: &t})
}

func (m *Manager) touchFileLocked(rec *model.AgentRecord, t *provider.FileTouch, now int64) {
	path := m.displayPathLocked(rec.ProjectID, t.Path)
	f := rec.Files[path]
	if f == nil {
		f = &model.FileActivity{Path: path}
		rec.Files[path] = f
	}
	f.LastAt = now
	if t.Phase == "end" {
		f.State = "recent"
	} else {
		f.LastOp = t.Op
		if t.Op == "write" {
			f.Writes++
			f.State = "writing"
			m.dirtyProjects[rec.ProjectID] = true
			m.addActivityLocked(rec, "file", "Writing "+path)
		} else {
			f.Reads++
			f.State = "reading"
			m.addActivityLocked(rec, "file", "Reading "+path)
		}
		// Only the latest operation keeps its diff, which bounds stored size.
		for i := range f.Ops {
			f.Ops[i].Diff = ""
		}
		f.Ops = append(f.Ops, model.FileOpRecord{Op: t.Op, Tool: t.Tool, At: now, Diff: model.Truncate(t.Diff, model.MaxDiffBytes)})
		if len(f.Ops) > model.MaxFileOps {
			f.Ops = f.Ops[len(f.Ops)-model.MaxFileOps:]
		}
	}
	m.emitLocked(model.Event{Type: "file", AgentID: rec.ID, File: ptr(copyFile(f, false))})
}

// ---- helpers (lock held) --------------------------------------------------

func (m *Manager) setStatusLocked(rec *model.AgentRecord, status model.Status, detail string) {
	if status == "" {
		return
	}
	changed := rec.Status != status
	rec.Status = status
	rec.StatusDetail = detail
	if changed && (status == model.StatusCompleted || status == model.StatusFailed ||
		status == model.StatusStopped || status == model.StatusWaiting) {
		text := detail
		if text == "" {
			text = string(status)
		}
		m.addActivityLocked(rec, "status", text)
	}
}

func (m *Manager) upsertMessageLocked(rec *model.AgentRecord, msg model.Message) {
	if idx := findMessage(rec.Messages, msg.ID); idx >= 0 {
		rec.Messages[idx] = msg
	} else {
		rec.Messages = appendCapped(rec.Messages, msg, model.MaxMessages)
	}
	cp := msg
	m.emitLocked(model.Event{Type: "message", AgentID: rec.ID, Message: &cp})
}

func (m *Manager) addActivityLocked(rec *model.AgentRecord, kind, text string) {
	m.seq++
	rec.Seq = m.seq
	e := model.ActivityEntry{ID: m.seq, Kind: kind, Text: text, At: nowMs()}
	rec.Activity = appendCapped(rec.Activity, e, model.MaxActivity)
	m.emitLocked(model.Event{Type: "activity", AgentID: rec.ID, Activity: &e})
}

func (m *Manager) addIssueLocked(rec *model.AgentRecord, level, text string) {
	m.seq++
	rec.Seq = m.seq
	is := model.Issue{ID: m.seq, Level: level, Text: model.Truncate(text, 2<<10), At: nowMs()}
	rec.Issues = appendCapped(rec.Issues, is, model.MaxIssues)
	m.emitLocked(model.Event{Type: "issue", AgentID: rec.ID, Issue: &is})
}

func (m *Manager) removeAgentLocked(id string) {
	if r, ok := m.runs[id]; ok {
		r.stopRequested = true
		r.cancel()
		delete(m.runs, id)
	}
	delete(m.agents, id)
	delete(m.dirtyAgents, id)
	m.pending = append(m.pending, model.Event{Type: "agentRemoved", ID: id})
	m.scheduleFlushLocked()
}

func (m *Manager) emitLocked(ev model.Event) {
	m.pending = append(m.pending, ev)
	m.scheduleFlushLocked()
}

func (m *Manager) markAgentLocked(id string) {
	m.dirtyAgents[id] = true
	if rec, ok := m.agents[id]; ok {
		m.dirtyProjects[rec.ProjectID] = true
	}
	m.scheduleFlushLocked()
}

func (m *Manager) scheduleFlushLocked() {
	if m.flushTimer == nil {
		m.flushTimer = time.AfterFunc(flushDelay, m.flush)
	}
}

// changedLocked tells the persistence layer that state changed. It must not block.
func (m *Manager) changedLocked() {
	if m.onChange != nil {
		m.onChange()
	}
}

// flush sends everything queued since the last flush as one batch.
// flushMu keeps batches in order even if two timers overlap.
func (m *Manager) flush() {
	m.flushMu.Lock()
	defer m.flushMu.Unlock()

	m.mu.Lock()
	m.flushTimer = nil
	batch := m.pending
	m.pending = nil
	for id := range m.dirtyAgents {
		if rec, ok := m.agents[id]; ok {
			s := m.summaryLocked(rec)
			batch = append(batch, model.Event{Type: "agent", ID: id, Agent: &s})
		}
	}
	m.dirtyAgents = map[string]bool{}
	for pid := range m.dirtyProjects {
		if p, ok := m.projects[pid]; ok {
			ps := m.projectSummaryLocked(p)
			batch = append(batch, model.Event{Type: "project", ID: pid, Project: &ps})
		}
	}
	m.dirtyProjects = map[string]bool{}
	if len(batch) > 0 {
		// Coalesced by the persistence layer, so long streams save about once a second.
		m.changedLocked()
	}
	m.mu.Unlock()

	if len(batch) > 0 && m.emit != nil {
		m.emit(batch)
	}
}

func (m *Manager) summaryLocked(rec *model.AgentRecord) model.AgentSummary {
	prov, hasProv := m.providers[rec.Provider]
	s := model.AgentSummary{
		ID:             rec.ID,
		ProjectID:      rec.ProjectID,
		Name:           rec.Name,
		Provider:       rec.Provider,
		ProviderName:   rec.Provider,
		Model:          rec.Model,
		Task:           rec.Task,
		PermissionMode: rec.PermissionMode,
		Status:         rec.Status,
		StatusDetail:   rec.StatusDetail,
		SessionID:      rec.SessionID,
		Running:        rec.Running,
		Position:       rec.Position,
		CreatedAt:      rec.CreatedAt,
		UpdatedAt:      rec.UpdatedAt,
		RunStartedAt:   rec.RunStartedAt,
		Turns:          rec.Turns,
		ToolCalls:      rec.ToolCalls,
		Usage:          rec.Usage,
		LastError:      rec.LastError,
		FileCount:      len(rec.Files),
		IssueCount:     len(rec.Issues),
	}
	recent := make([]model.FileActivity, 0, len(rec.Files))
	for _, f := range rec.Files {
		if f.Writes > 0 {
			s.WriteCount++
		}
		recent = append(recent, copyFile(f, false))
	}
	sort.Slice(recent, func(i, j int) bool { return recent[i].LastAt > recent[j].LastAt })
	if len(recent) > maxRecentFiles {
		recent = recent[:maxRecentFiles]
	}
	s.RecentFiles = recent
	if hasProv {
		s.ProviderName = prov.Name()
		s.Capabilities = prov.Capabilities()
	}
	return s
}

func (m *Manager) capsLocked(rec *model.AgentRecord) model.Capabilities {
	if prov, ok := m.providers[rec.Provider]; ok {
		return prov.Capabilities()
	}
	return model.Capabilities{}
}

func (m *Manager) projectSummaryLocked(p *model.Project) model.ProjectSummary {
	ps := model.ProjectSummary{Project: *p, Conflicts: []model.Conflict{}}
	var writes []conflict.AgentWrites
	for _, a := range m.agents {
		if a.ProjectID != p.ID {
			continue
		}
		ps.AgentCount++
		if a.Running {
			ps.RunningCount++
		}
		w := map[string]int{}
		for path, f := range a.Files {
			if f.Writes > 0 {
				w[path] = f.Writes
			}
		}
		writes = append(writes, conflict.AgentWrites{ID: a.ID, Name: a.Name, Writes: w})
	}
	sort.Slice(writes, func(i, j int) bool { return writes[i].Name < writes[j].Name })
	ps.Conflicts = conflict.Detect(writes)
	return ps
}

func (m *Manager) countAgentsLocked(projectID string) int {
	n := 0
	for _, a := range m.agents {
		if a.ProjectID == projectID {
			n++
		}
	}
	return n
}

func (m *Manager) displayPathLocked(projectID, p string) string {
	if proj, ok := m.projects[projectID]; ok && filepath.IsAbs(p) {
		if rel, err := filepath.Rel(proj.RepoPath, p); err == nil && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
			return filepath.ToSlash(rel)
		}
	}
	return filepath.ToSlash(p)
}

// ---- small utilities ------------------------------------------------------

func copyFile(f *model.FileActivity, withOps bool) model.FileActivity {
	c := *f
	if withOps {
		c.Ops = append([]model.FileOpRecord(nil), f.Ops...)
	} else {
		c.Ops = nil
	}
	return c
}

func appendCapped[T any](list []T, item T, max int) []T {
	list = append(list, item)
	if len(list) > max {
		list = list[len(list)-max:]
	}
	return list
}

func findMessage(list []model.Message, id string) int {
	for i := len(list) - 1; i >= 0; i-- {
		if list[i].ID == id {
			return i
		}
	}
	return -1
}

func roleOr(r string) string {
	if r == "" {
		return "assistant"
	}
	return r
}

func firstLine(s string, max int) string {
	s = strings.TrimSpace(s)
	if i := strings.IndexByte(s, '\n'); i >= 0 {
		s = s[:i]
	}
	if len(s) > max {
		s = s[:max] + "…"
	}
	return s
}

func shortName(p provider.Provider) string {
	switch p.ID() {
	case "claude":
		return "Claude"
	case "codex":
		return "Codex"
	}
	return p.Name()
}

func ptr[T any](v T) *T { return &v }

func nowMs() int64 { return time.Now().UnixMilli() }

func newID() string {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// newUUID returns a random RFC 4122 version 4 UUID, as Claude Code requires for --session-id.
func newUUID() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	h := hex.EncodeToString(b)
	return h[0:8] + "-" + h[8:12] + "-" + h[12:16] + "-" + h[16:20] + "-" + h[20:32]
}
