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
	"orbit/internal/gitdiff"
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
	// reply is the agent's last assistant message this turn. Conversations relay it.
	reply string
	// startedAt and prompt describe the turn. Auto-commit uses them to find the files
	// this turn wrote and to name the commit.
	startedAt int64
	prompt    string
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
	handoffs      []model.Handoff // newest last, capped at maxHandoffs
	conversations []model.Conversation
	pending       []model.Event
	flushTimer    *time.Timer
	flushMu       sync.Mutex
	emit          func([]model.Event)
	onChange      func()
	seq           int64
	iconDir       string
	// attachmentDir holds the images sent in chat messages. See attachments.go.
	attachmentDir string
	// browserCmd is the Orbit executable that gives agents the browser tool. See SetBrowserCommand.
	browserCmd string
	// automations are the scheduled launches. See automation.go.
	automations map[string]*model.Automation
	// sshProfiles are saved SSH connections. See ssh.go.
	sshProfiles map[string]*model.SSHProfile
}

// New creates an empty manager. emit receives each flushed batch; onChange is
// called whenever persisted state changes and must not block.
func New(emit func([]model.Event), onChange func()) *Manager {
	return &Manager{
		projects:      map[string]*model.Project{},
		agents:        map[string]*model.AgentRecord{},
		automations:   map[string]*model.Automation{},
		sshProfiles:   map[string]*model.SSHProfile{},
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
	for i := range st.Automations {
		a := st.Automations[i]
		m.automations[a.ID] = &a
	}
	for i := range st.SSHProfiles {
		p := st.SSHProfiles[i]
		m.sshProfiles[p.ID] = &p
	}
}

// Persist calls fn with the current state while holding the lock, so the
// caller can serialise it without racing with running agents.
func (m *Manager) Persist(fn func(store.State) error) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	st := store.State{Version: store.Version, Projects: []model.Project{}, Agents: []model.AgentRecord{}, Automations: []model.Automation{}, SSHProfiles: []model.SSHProfile{}}
	for _, p := range m.projects {
		st.Projects = append(st.Projects, *p)
	}
	for _, a := range m.agents {
		st.Agents = append(st.Agents, *a)
	}
	for _, a := range m.automations {
		st.Automations = append(st.Automations, *a)
	}
	for _, p := range m.sshProfiles {
		st.SSHProfiles = append(st.SSHProfiles, *p)
	}
	sort.Slice(st.Automations, func(i, j int) bool { return st.Automations[i].CreatedAt < st.Automations[j].CreatedAt })
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
	return agentDirLocked(rec, p), nil
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
	for autoID, a := range m.automations {
		if a.ProjectID == id {
			delete(m.automations, autoID)
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
	// FastMode runs the agent in fast mode. Only valid for a model that supports it.
	FastMode bool `json:"fastMode"`
	// UltraFast runs the agent in the account's ultrafast mode. It implies FastMode, and is only valid
	// for a model the account can run that way.
	UltraFast bool `json:"ultraFast"`
	// Effort is the thinking effort level. Empty uses the CLI default. Must be one the model offers.
	Effort string `json:"effort"`
	// Branch is the git branch to work on. Empty uses the project folder as it is. With NewBranch
	// set, Branch names a new branch to create from HEAD.
	Branch    string `json:"branch"`
	NewBranch bool   `json:"newBranch"`
}

// Launch creates an agent in a project and, when a task is given, starts its first turn.
func (m *Manager) Launch(req LaunchRequest) (model.AgentSummary, error) {
	return m.launch(req, "")
}

// launch creates an agent. When sameAs names an agent, the new one works in that agent's folder and
// branch, so a pair shares its files. Otherwise the request's branch choice decides the workspace.
func (m *Manager) launch(req LaunchRequest, sameAs string) (model.AgentSummary, error) {
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
	if req.UltraFast && !prov.Capabilities().SupportsUltraFast(req.Model) {
		return model.AgentSummary{}, fmt.Errorf("ultrafast mode is not available for this model on %s", prov.Name())
	}
	// Ultrafast is a faster tier of fast mode, so it turns fast mode on too.
	req.FastMode = req.FastMode || req.UltraFast
	if req.FastMode && !prov.Capabilities().SupportsFastMode(req.Model) {
		return model.AgentSummary{}, fmt.Errorf("fast mode is not available for this model on %s", prov.Name())
	}
	if req.Effort != "" && !prov.Capabilities().SupportsEffort(req.Model, req.Effort) {
		return model.AgentSummary{}, fmt.Errorf("%q thinking is not available for this model on %s", req.Effort, prov.Name())
	}

	// Creating a worktree runs git, so it happens before the lock: other agents are not held up by it.
	m.mu.Lock()
	proj, ok := m.projects[req.ProjectID]
	m.mu.Unlock()
	if !ok {
		return model.AgentSummary{}, errors.New("choose a project first")
	}
	if info, err := os.Stat(proj.RepoPath); err != nil || !info.IsDir() {
		return model.AgentSummary{}, errors.New("the project's repository folder is missing")
	}
	var dir, branch string
	var err error
	if sameAs != "" {
		dir, branch, err = m.sharedWorkspace(sameAs, proj.RepoPath)
	} else {
		dir, branch, err = workspaceFor(proj, req)
	}
	if err != nil {
		return model.AgentSummary{}, err
	}

	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.projects[req.ProjectID]; !ok {
		return model.AgentSummary{}, errors.New("choose a project first")
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
		FastMode:       req.FastMode,
		UltraFast:      req.UltraFast,
		Effort:         req.Effort,
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
	rec.Branch = branch
	if dir != proj.RepoPath {
		rec.WorkDir = dir
	}
	m.agents[rec.ID] = rec
	m.markAgentLocked(rec.ID)
	m.changedLocked()

	if rec.Task != "" {
		if err := m.startTurnLocked(rec, rec.Task, nil); err != nil {
			return m.summaryLocked(rec), err
		}
	}
	return m.summaryLocked(rec), nil
}

// sharedWorkspace returns the folder and branch of an existing agent, for an agent that works alongside it.
func (m *Manager) sharedWorkspace(agentID, repoPath string) (dir, branch string, err error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	rec, ok := m.agents[agentID]
	if !ok {
		return "", "", ErrNotFound
	}
	dir = repoPath
	if rec.WorkDir != "" {
		dir = rec.WorkDir
	}
	return dir, rec.Branch, nil
}

// Send starts a new turn with the given message.
// maxHandoffs bounds the handoffs kept in memory. Old ones fall off first.
const maxHandoffs = 50

// ErrOtherProject is returned when a handoff would cross between projects or to the same agent.
var ErrOtherProject = errors.New("delegate to another agent in the same project")

// Delegate starts a turn on agent toID with task, on behalf of fromID, and records a handoff
// that stays active until toID's turn ends.
func (m *Manager) Delegate(fromID, toID, task string) (model.Handoff, error) {
	task = strings.TrimSpace(task)
	if task == "" {
		return model.Handoff{}, errors.New("describe the task first")
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	from, okFrom := m.agents[fromID]
	to, okTo := m.agents[toID]
	if !okFrom || !okTo {
		return model.Handoff{}, ErrNotFound
	}
	if fromID == toID || from.ProjectID != to.ProjectID {
		return model.Handoff{}, ErrOtherProject
	}
	if !m.capsLocked(to).Send {
		return model.Handoff{}, errors.New("this provider does not accept messages")
	}
	prompt := fmt.Sprintf("%s delegated this task to you:\n\n%s", from.Name, task)
	if err := m.startTurnLocked(to, prompt, nil); err != nil {
		return model.Handoff{}, err
	}
	now := nowMs()
	h := model.Handoff{
		ID: newID(), ProjectID: to.ProjectID, FromID: fromID, ToID: toID,
		Task: model.Truncate(task, 240), Status: model.HandoffActive, At: now,
	}
	m.handoffs = append(m.handoffs, h)
	if len(m.handoffs) > maxHandoffs {
		m.handoffs = m.handoffs[len(m.handoffs)-maxHandoffs:]
	}
	m.dirtyProjects[to.ProjectID] = true
	return h, nil
}

// settleHandoffsLocked ends the active handoffs to agent toID when its turn finishes.
func (m *Manager) settleHandoffsLocked(toID string, success bool, now int64) {
	status := model.HandoffFailed
	if success {
		status = model.HandoffDone
	}
	for i := range m.handoffs {
		h := &m.handoffs[i]
		if h.ToID != toID || h.Status != model.HandoffActive {
			continue
		}
		h.Status = status
		h.DoneAt = now
		m.dirtyProjects[h.ProjectID] = true
	}
}

// Send starts a new turn with the given text and optional images. Text may be empty when
// images are attached.
func (m *Manager) Send(agentID, text string, uploads []model.ImageUpload) error {
	text = strings.TrimSpace(text)
	if text == "" && len(uploads) == 0 {
		return errors.New("type a message first")
	}
	images, err := m.saveImages(uploads)
	if err != nil {
		return err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	rec, ok := m.agents[agentID]
	if !ok {
		removeImageFiles(images)
		return ErrNotFound
	}
	if !m.capsLocked(rec).Send {
		removeImageFiles(images)
		return errors.New("this provider does not accept messages")
	}
	if err := m.startTurnLocked(rec, text, images); err != nil {
		removeImageFiles(images)
		return err
	}
	return nil
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
	return m.startTurnLocked(rec, "Continue from where you stopped and finish the task.", nil)
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

// ListFiles returns the names in one directory of a project's repository. Directory
// entries end with "/". Used by the chat @-mention autocomplete.
func (m *Manager) ListFiles(projectID, relPath string) ([]string, error) {
	m.mu.Lock()
	proj, ok := m.projects[projectID]
	m.mu.Unlock()
	if !ok {
		return nil, errors.New("choose a project first")
	}
	dir := proj.RepoPath
	if relPath != "" {
		dir = filepath.Join(dir, filepath.FromSlash(relPath))
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}
	out := make([]string, 0, len(entries))
	for _, e := range entries {
		name := e.Name()
		if e.IsDir() {
			name += "/"
		}
		out = append(out, name)
	}
	sort.Strings(out)
	return out, nil
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

// Acknowledge clears a finished turn's "completed" mark once the user has looked at the agent.
// Any other status is left alone: a running, failed or waiting agent keeps its state.
func (m *Manager) Acknowledge(agentID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	rec, ok := m.agents[agentID]
	if !ok {
		return ErrNotFound
	}
	if rec.Status != model.StatusCompleted {
		return nil
	}
	m.setStatusLocked(rec, model.StatusIdle, "Ready for a task")
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

// SetModel changes the model an agent uses from its next message. The model must be one the provider
// offers, and effort and fast mode must suit it. A reply already in progress keeps the settings it
// started with, so this can be called mid-reply; the change applies from the next message.
func (m *Manager) SetModel(agentID, modelID, effort string, fastMode, ultraFast bool) (model.AgentSummary, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	rec, ok := m.agents[agentID]
	if !ok {
		return model.AgentSummary{}, ErrNotFound
	}
	prov, ok := m.providers[rec.Provider]
	if !ok {
		return model.AgentSummary{}, fmt.Errorf("unknown provider %q", rec.Provider)
	}
	modelID = strings.TrimSpace(modelID)
	caps := m.capsLocked(rec)
	if modelID != "" && len(caps.Models) > 0 && !caps.HasModel(modelID) {
		return model.AgentSummary{}, fmt.Errorf("%s does not offer the model %q", prov.Name(), modelID)
	}
	if effort != "" && !caps.SupportsEffort(modelID, effort) {
		return model.AgentSummary{}, fmt.Errorf("%q thinking is not available for this model on %s", effort, prov.Name())
	}
	if ultraFast && !caps.SupportsUltraFast(modelID) {
		return model.AgentSummary{}, fmt.Errorf("ultrafast mode is not available for this model on %s", prov.Name())
	}
	fastMode = fastMode || ultraFast
	if fastMode && !caps.SupportsFastMode(modelID) {
		return model.AgentSummary{}, fmt.Errorf("fast mode is not available for this model on %s", prov.Name())
	}
	rec.Model = modelID
	rec.Effort = effort
	rec.FastMode = fastMode
	rec.UltraFast = ultraFast
	m.markAgentLocked(agentID)
	m.changedLocked()
	return m.summaryLocked(rec), nil
}

// SetBranch moves an agent to another branch of its project's repository from its next message. The
// branch is checked out as the agent's folder, a worktree when it is not the branch in the project
// folder, as at launch. The agent starts a fresh session there, because a session belongs to the
// folder it was made in. The transcript stays. An agent that is replying or in a talk cannot move
// until that finishes.
func (m *Manager) SetBranch(agentID, branch string) (model.AgentSummary, error) {
	m.mu.Lock()
	rec, ok := m.agents[agentID]
	if !ok {
		m.mu.Unlock()
		return model.AgentSummary{}, ErrNotFound
	}
	proj, ok := m.projects[rec.ProjectID]
	if !ok {
		m.mu.Unlock()
		return model.AgentSummary{}, errors.New("the agent's project no longer exists")
	}
	if err := m.checkBranchChangeLocked(agentID, rec); err != nil {
		m.mu.Unlock()
		return model.AgentSummary{}, err
	}
	m.mu.Unlock()

	// Creating a worktree runs git, so it happens outside the lock, as at launch.
	dir, branch, err := workspaceFor(proj, LaunchRequest{Branch: branch})
	if err != nil {
		return model.AgentSummary{}, err
	}

	m.mu.Lock()
	defer m.mu.Unlock()
	rec, ok = m.agents[agentID]
	if !ok {
		return model.AgentSummary{}, ErrNotFound
	}
	if err := m.checkBranchChangeLocked(agentID, rec); err != nil {
		return model.AgentSummary{}, err
	}
	rec.Branch = branch
	rec.WorkDir = ""
	if dir != proj.RepoPath {
		rec.WorkDir = dir
	}
	rec.SessionSeen = false
	rec.SessionID = ""
	if rec.Provider == "claude" {
		// Claude Code takes a session id chosen by the caller, as at launch.
		rec.SessionID = newUUID()
	}
	m.markAgentLocked(agentID)
	m.changedLocked()
	return m.summaryLocked(rec), nil
}

// checkBranchChangeLocked refuses a branch change while the agent is replying or in a talk.
func (m *Manager) checkBranchChangeLocked(agentID string, rec *model.AgentRecord) error {
	if rec.Running {
		return errors.New("wait for the reply to finish before changing the branch")
	}
	if m.inConversationLocked(agentID) {
		return errors.New("this agent is in a talk; end the talk before changing the branch")
	}
	return nil
}

// SetPermissionMode changes an agent's permission mode from its next message. The mode must be one
// the provider offers. As with SetModel, a reply in progress keeps the mode it started with.
func (m *Manager) SetPermissionMode(agentID, mode string) (model.AgentSummary, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	rec, ok := m.agents[agentID]
	if !ok {
		return model.AgentSummary{}, ErrNotFound
	}
	caps := m.capsLocked(rec)
	offered := false
	for _, p := range caps.PermissionModes {
		if p.ID == mode {
			offered = true
		}
	}
	if !offered {
		return model.AgentSummary{}, fmt.Errorf("%s does not offer the permission mode %q", m.providers[rec.Provider].Name(), mode)
	}
	rec.PermissionMode = mode
	m.markAgentLocked(agentID)
	m.changedLocked()
	return m.summaryLocked(rec), nil
}

// ---- turn lifecycle -------------------------------------------------------

// startTurnLocked begins a turn. images are already stored on disk; the caller removes them if
// this returns an error.
func (m *Manager) startTurnLocked(rec *model.AgentRecord, prompt string, images []storedImage) error {
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
	r := &run{cancel: cancel, startedAt: nowMs(), prompt: prompt}
	m.runs[rec.ID] = r

	// The provider needs some text even when the user only attached images.
	sent := prompt
	if sent == "" {
		sent = "Describe the attached image."
		if len(images) > 1 {
			sent = "Describe the attached images."
		}
	}

	now := nowMs()
	rec.Running = true
	rec.Turns++
	rec.RunStartedAt = now
	rec.LastError = ""
	rec.Status = model.StatusThinking
	rec.StatusDetail = "Starting"
	m.upsertMessageLocked(rec, model.Message{
		ID:          newID(),
		Role:        "user",
		Text:        model.Truncate(prompt, model.MaxTextBytes),
		At:          now,
		Attachments: attachmentsOf(images),
	})
	m.addActivityLocked(rec, "message", "You: "+firstLine(sent, 90))
	m.markAgentLocked(rec.ID)
	m.changedLocked()

	spec := provider.Spec{
		AgentID:        rec.ID,
		RepoPath:       agentDirLocked(rec, proj),
		Prompt:         sent,
		SessionID:      rec.SessionID,
		Resume:         rec.SessionSeen && rec.SessionID != "",
		Model:          rec.Model,
		PermissionMode: rec.PermissionMode,
		FastMode:       rec.FastMode,
		UltraFast:      rec.UltraFast,
		Effort:         rec.Effort,
		Images:         providerImages(images),
		BrowserCommand: m.browserCmd,
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
	m.maybeAutoCommitLocked(rec, r)
	m.advanceConversationLocked(rec, r)
	m.markAgentLocked(id)
	m.changedLocked()
}

// maybeAutoCommitLocked starts a commit of the files this turn wrote, when the project has
// auto-commit on and the turn completed. The git work runs in its own goroutine, so it
// waits for the lock to be released and never blocks event handling.
func (m *Manager) maybeAutoCommitLocked(rec *model.AgentRecord, r *run) {
	proj, ok := m.projects[rec.ProjectID]
	if !ok || !proj.AutoCommit || rec.Status != model.StatusCompleted {
		return
	}
	paths := turnWrites(rec, r.startedAt)
	if len(paths) == 0 {
		return
	}
	go m.autoCommit(rec.ID, agentDirLocked(rec, proj), paths, autoCommitMessage(rec.Name, r.prompt))
}

// autoCommit commits the given paths and logs the outcome on the agent's activity.
func (m *Manager) autoCommit(agentID, repo string, paths []string, message string) {
	hash, err := gitdiff.Commit(repo, message, paths)

	m.mu.Lock()
	defer m.mu.Unlock()
	rec, ok := m.agents[agentID]
	if !ok {
		return
	}
	if err != nil {
		m.addActivityLocked(rec, "commit", "Auto-commit skipped: "+firstLine(err.Error(), 140))
	} else {
		m.addActivityLocked(rec, "commit", "Auto-committed "+hash+": "+firstLine(message, 90))
	}
	m.markAgentLocked(agentID)
	m.changedLocked()
}

// turnWrites lists the files the agent wrote at or after since.
func turnWrites(rec *model.AgentRecord, since int64) []string {
	var paths []string
	for _, f := range rec.Files {
		for _, op := range f.Ops {
			if op.Op == "write" && op.At >= since {
				paths = append(paths, f.Path)
				break
			}
		}
	}
	sort.Strings(paths)
	return paths
}

// autoCommitMessage names the commit after the agent and its request.
func autoCommitMessage(agentName, prompt string) string {
	what := firstLine(prompt, 72)
	if what == "" {
		what = "update files"
	}
	return "Orbit: " + agentName + " - " + what
}

// SetProjectAutoCommit turns auto-commit on or off for a project.
func (m *Manager) SetProjectAutoCommit(id string, on bool) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	p, ok := m.projects[id]
	if !ok {
		return errors.New("that project no longer exists")
	}
	p.AutoCommit = on
	m.dirtyProjects[id] = true
	m.scheduleFlushLocked()
	m.changedLocked()
	return nil
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
			if rec.Messages[idx].Role == "assistant" {
				r.reply = rec.Messages[idx].Text
			}
			m.pending = append(m.pending, model.Event{Type: "messageEnd", AgentID: rec.ID, MessageID: u.ID})
			m.scheduleFlushLocked()
			m.addActivityLocked(rec, "message", "Agent replied: "+firstLine(rec.Messages[idx].Text, 90))
		}
	case provider.UpdMessage:
		m.upsertMessageLocked(rec, model.Message{ID: u.ID, Role: roleOr(u.Role), Text: model.Truncate(u.Text, model.MaxTextBytes), At: now})
		if roleOr(u.Role) == "assistant" {
			r.reply = u.Text
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
	case provider.UpdSubAgentStart:
			startSubAgent(rec, u, now)
			m.addActivityLocked(rec, "system", "Sub-agent started: "+firstLine(u.Text, 90))
		case provider.UpdSubAgentActivity:
			if s := findSubAgent(rec, u.ID); s != nil {
				s.Actions++
				s.Detail = model.Truncate(u.Detail, 120)
			}
		case provider.UpdSubAgentEnd:
			if s := findSubAgent(rec, u.ID); s != nil {
				s.Status = "ok"
				if u.Failed {
					s.Status = "error"
				}
				s.DoneAt = now
			}
		case provider.UpdTurnDone:
		r.done = true
		r.success = u.Success
		r.text = u.Text
		if u.Text != "" && u.Success {
			r.reply = u.Text
			rec.StatusDetail = firstLine(u.Text, 120)
		}
		finishSubAgents(rec, now)
			m.settleHandoffsLocked(rec.ID, u.Success, now)
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
	m.endConversationsOfLocked(id, "An agent in this talk was removed")
	if r, ok := m.runs[id]; ok {
		r.stopRequested = true
		r.cancel()
		delete(m.runs, id)
	}
	if rec, ok := m.agents[id]; ok {
		m.removeAttachmentFilesLocked(rec)
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
		FastMode:       rec.FastMode,
		UltraFast:      rec.UltraFast,
		Effort:         rec.Effort,
		Task:           rec.Task,
		Branch:         rec.Branch,
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
	s.RecentTools = recentToolSummaries(rec.Tools)
	s.SubAgents = append(make([]model.SubAgent, 0, len(rec.SubAgents)), rec.SubAgents...)
	if hasProv {
		s.ProviderName = prov.Name()
		s.Capabilities = prov.Capabilities()
	}
	return s
}

// maxRecentTools bounds the tool calls sent with every agent summary.
const maxRecentTools = 8

// recentToolSummaries returns the latest tool calls that are still running, without their input
// or output, so the summary stays light. Finished calls drop out, so their rocks leave the galaxy.
// It never returns nil, so an empty list serialises as [].
func recentToolSummaries(tools []model.ToolCall) []model.ToolCall {
	var running []model.ToolCall
	for _, t := range tools {
		if t.Status != "running" {
			continue
		}
		t.Input = ""
		t.Output = ""
		running = append(running, t)
	}
	if len(running) > maxRecentTools {
		running = running[len(running)-maxRecentTools:]
	}
	out := make([]model.ToolCall, 0, len(running))
	return append(out, running...)
}

func (m *Manager) capsLocked(rec *model.AgentRecord) model.Capabilities {
	if prov, ok := m.providers[rec.Provider]; ok {
		return prov.Capabilities()
	}
	return model.Capabilities{}
}

func (m *Manager) projectSummaryLocked(p *model.Project) model.ProjectSummary {
	ps := model.ProjectSummary{Project: *p, Conflicts: []model.Conflict{}, Handoffs: []model.Handoff{}, Conversations: []model.Conversation{}}
	for _, h := range m.handoffs {
		if h.ProjectID == p.ID {
			ps.Handoffs = append(ps.Handoffs, h)
		}
	}
	for _, c := range m.conversations {
		if c.ProjectID == p.ID {
			ps.Conversations = append(ps.Conversations, c)
		}
	}
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

// startSubAgent records a new running sub-agent. Once the list is full, the oldest one falls off.
func startSubAgent(rec *model.AgentRecord, u provider.Update, now int64) {
	if findSubAgent(rec, u.ID) != nil {
		// A provider can report the same sub-agent more than once; keep the first record.
		return
	}
	s := model.SubAgent{ID: u.ID, Name: model.Truncate(u.Text, 240), Kind: u.Detail, Status: "running", At: now}
	rec.SubAgents = append(rec.SubAgents, s)
	if len(rec.SubAgents) > model.MaxSubAgents {
		rec.SubAgents = rec.SubAgents[len(rec.SubAgents)-model.MaxSubAgents:]
	}
}

// findSubAgent returns the sub-agent started by the given Task call, or nil.
func findSubAgent(rec *model.AgentRecord, id string) *model.SubAgent {
	for i := len(rec.SubAgents) - 1; i >= 0; i-- {
		if rec.SubAgents[i].ID == id {
			return &rec.SubAgents[i]
		}
	}
	return nil
}

// finishSubAgents marks sub-agents still running when their turn ends as done, so none stays animated.
func finishSubAgents(rec *model.AgentRecord, now int64) {
	for i := range rec.SubAgents {
		if rec.SubAgents[i].Status == "running" {
			rec.SubAgents[i].Status = "ok"
			rec.SubAgents[i].DoneAt = now
		}
	}
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
