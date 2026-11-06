package main

import (
	"context"
	"encoding/base64"
	"errors"
	"path/filepath"
	"sync"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"

	"orbit/internal/agent"
	"orbit/internal/gitdiff"
	"orbit/internal/model"
	"orbit/internal/provider"
	"orbit/internal/store"
	"orbit/internal/terminal"
)

// eventName is the single channel for batched agent updates.
const eventName = "orbit:events"

// Terminal channels: output is batched by the terminal package, exit fires once per shell.
const (
	terminalOutputEvent = "terminal:output"
	terminalExitEvent   = "terminal:exit"
)

// TerminalOutput is one chunk of text from a terminal.
type TerminalOutput struct {
	ID   string `json:"id"`
	Data string `json:"data"`
}

// saveDelay coalesces bursts of changes into one write.
const saveDelay = 900 * time.Millisecond

// App is the Wails-bound backend. Its exported methods are callable from the frontend.
type App struct {
	ctx       context.Context
	mgr       *agent.Manager
	terms     *terminal.Manager
	statePath string
	loadErr   string

	saveMu    sync.Mutex
	saveTimer *time.Timer
	saveErr   string
}

// NewApp builds the backend. Wails calls startup once the window exists.
func NewApp() *App {
	a := &App{}
	a.mgr = agent.New(a.emitBatch, a.scheduleSave)
	a.terms = terminal.New(a.emitTerminalOutput, a.emitTerminalExit)
	return a
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	path, err := store.DefaultPath()
	if err != nil {
		a.loadErr = err.Error()
		return
	}
	a.statePath = path
	a.mgr.SetIconDir(filepath.Join(filepath.Dir(path), "icons"))
	st, err := store.Load(path)
	if err != nil {
		a.loadErr = err.Error()
	}
	a.mgr.Load(st)
}

func (a *App) shutdown(context.Context) {
	a.terms.CloseAll()
	a.saveNow()
}

func (a *App) emitTerminalOutput(id, data string) {
	if a.ctx != nil {
		runtime.EventsEmit(a.ctx, terminalOutputEvent, TerminalOutput{ID: id, Data: data})
	}
}

func (a *App) emitTerminalExit(id string) {
	if a.ctx != nil {
		runtime.EventsEmit(a.ctx, terminalExitEvent, map[string]string{"id": id})
	}
}

// OpenTerminal starts a shell in a project's repository folder. The window picks the id so it
// can listen for output before the shell prints anything.
func (a *App) OpenTerminal(terminalID, projectID string, cols, rows int) error {
	dir, err := a.mgr.ProjectRepo(projectID)
	if err != nil {
		return err
	}
	return a.terms.Open(terminalID, dir, cols, rows)
}

// WriteTerminal sends keystrokes to a terminal.
func (a *App) WriteTerminal(terminalID, data string) error {
	return a.terms.Write(terminalID, data)
}

// ResizeTerminal tells a terminal its size in cells.
func (a *App) ResizeTerminal(terminalID string, cols, rows int) error {
	return a.terms.Resize(terminalID, cols, rows)
}

// CloseTerminal ends a terminal and its shell.
func (a *App) CloseTerminal(terminalID string) error {
	return a.terms.Close(terminalID)
}

// emitBatch delivers one batch of updates to the window.
func (a *App) emitBatch(batch []model.Event) {
	if a.ctx == nil {
		return
	}
	runtime.EventsEmit(a.ctx, eventName, batch)
}

func (a *App) scheduleSave() {
	a.saveMu.Lock()
	defer a.saveMu.Unlock()
	if a.saveTimer == nil {
		a.saveTimer = time.AfterFunc(saveDelay, a.saveNow)
	}
}

func (a *App) saveNow() {
	a.saveMu.Lock()
	if a.saveTimer != nil {
		a.saveTimer.Stop()
		a.saveTimer = nil
	}
	a.saveMu.Unlock()
	if a.statePath == "" {
		return
	}
	err := a.mgr.Persist(func(st store.State) error { return store.Save(a.statePath, st) })
	a.saveMu.Lock()
	defer a.saveMu.Unlock()
	if err != nil {
		a.saveErr = err.Error()
	} else {
		a.saveErr = ""
	}
}

// ---- snapshot -------------------------------------------------------------

// Snapshot is everything the UI needs to render the first frame.
type Snapshot struct {
	Projects     []model.ProjectSummary `json:"projects"`
	Agents       []model.AgentSummary   `json:"agents"`
	Providers    []provider.Info        `json:"providers"`
	StatePath    string                 `json:"statePath"`
	StorageError string                 `json:"storageError"`
	Version      string                 `json:"version"`
}

// GetSnapshot returns the current projects, agents and provider availability.
func (a *App) GetSnapshot() Snapshot {
	a.saveMu.Lock()
	storageErr := a.saveErr
	a.saveMu.Unlock()
	if storageErr == "" {
		storageErr = a.loadErr
	}
	return Snapshot{
		Projects:     a.mgr.Projects(),
		Agents:       a.mgr.Agents(),
		Providers:    provider.Infos(),
		StatePath:    a.statePath,
		StorageError: storageErr,
		Version:      "0.1.0",
	}
}

// GetAgentDetail returns the full history of one agent for the inspector.
func (a *App) GetAgentDetail(agentID string) (model.AgentDetail, error) {
	return a.mgr.Detail(agentID)
}

// FileDiffResult carries the diff Orbit recorded and, when available, the git diff.
type FileDiffResult struct {
	Path      string `json:"path"`
	Recorded  string `json:"recorded"`
	GitDiff   string `json:"gitDiff"`
	GitNotice string `json:"gitNotice"`
}

// GetFileDiff returns the diff for one file touched by an agent.
func (a *App) GetFileDiff(agentID, path string) (FileDiffResult, error) {
	res := FileDiffResult{Path: path}
	detail, err := a.mgr.Detail(agentID)
	if err != nil {
		return res, err
	}
	for _, f := range detail.Files {
		if f.Path != path {
			continue
		}
		for i := len(f.Ops) - 1; i >= 0; i-- {
			if f.Ops[i].Diff != "" {
				res.Recorded = f.Ops[i].Diff
				break
			}
		}
	}
	repo, err := a.mgr.ProjectPath(agentID)
	if err != nil {
		return res, err
	}
	diff, err := gitdiff.File(repo, path)
	switch {
	case errors.Is(err, gitdiff.ErrNotGit):
		res.GitNotice = err.Error()
	case err != nil:
		res.GitNotice = err.Error()
	default:
		res.GitDiff = diff
	}
	return res, nil
}

// ---- projects -------------------------------------------------------------

// PickRepository opens a native folder picker. It returns "" when cancelled.
func (a *App) PickRepository() (string, error) {
	if a.ctx == nil {
		return "", errors.New("the window is not ready yet")
	}
	return runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "Choose the project's repository folder",
	})
}

// CreateProject registers a folder as a project.
func (a *App) CreateProject(name, repoPath string) (model.ProjectSummary, error) {
	return a.mgr.CreateProject(name, repoPath)
}

// SetProjectIcon sets the letter shown on a project's sun. Empty restores the default.
func (a *App) SetProjectIcon(projectID, icon string) error {
	return a.mgr.SetProjectIcon(projectID, icon)
}

// SetProjectIconImage stores a PNG (base64-encoded) as a project's icon. Its letter is cleared.
func (a *App) SetProjectIconImage(projectID, pngBase64 string) error {
	data, err := base64.StdEncoding.DecodeString(pngBase64)
	if err != nil {
		return errors.New("the icon could not be read")
	}
	return a.mgr.SetProjectIconImage(projectID, data)
}

// GetProjectIcon returns a project's uploaded icon as a PNG data URL, or "" if it has none.
func (a *App) GetProjectIcon(projectID string) (string, error) {
	return a.mgr.ProjectIconImage(projectID)
}

// DeleteProject stops and removes a project and its agents.
func (a *App) DeleteProject(projectID string) error {
	return a.mgr.DeleteProject(projectID)
}

// ---- agents ---------------------------------------------------------------

// LaunchAgent creates an agent and optionally starts its first task.
func (a *App) LaunchAgent(req agent.LaunchRequest) (model.AgentSummary, error) {
	return a.mgr.Launch(req)
}

// SendMessage sends a message, starting a new turn.
func (a *App) SendMessage(agentID, text string) error {
	return a.mgr.Send(agentID, text)
}

// ResumeAgent continues the agent's last session.
func (a *App) ResumeAgent(agentID string) error {
	return a.mgr.Resume(agentID)
}

// StopAgent cancels the running turn.
func (a *App) StopAgent(agentID string) error {
	return a.mgr.Stop(agentID)
}

// RemoveAgent deletes an agent, stopping it first if needed.
func (a *App) RemoveAgent(agentID string) error {
	return a.mgr.Remove(agentID)
}

// RenameAgent changes an agent's display name.
func (a *App) RenameAgent(agentID, name string) error {
	return a.mgr.Rename(agentID, name)
}

// SetAgentPosition stores where the user placed an agent.
func (a *App) SetAgentPosition(agentID string, x, y float64) error {
	return a.mgr.SetPosition(agentID, x, y)
}
