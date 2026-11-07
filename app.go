package main

import (
	"context"
	"encoding/base64"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"

	"orbit/internal/agent"
	"orbit/internal/browser"
	"orbit/internal/gitdiff"
	"orbit/internal/model"
	"orbit/internal/provider"
	"orbit/internal/release"
	"orbit/internal/store"
	"orbit/internal/terminal"
	"orbit/internal/webpane"
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

// automationsEvent carries the full automation list whenever it changes.
const automationsEvent = "orbit:automations"

// automationTick is how often due automations are checked. Slots are compared by time, not counted,
// so a laptop that wakes from sleep catches up on its next tick.
const automationTick = 30 * time.Second

// App is the Wails-bound backend. Its exported methods are callable from the frontend.
type App struct {
	ctx       context.Context
	wails     *application.App
	mgr       *agent.Manager
	terms     *terminal.Manager
	limits    provider.LimitsCache
	statePath string
	loadErr   string

	saveMu    sync.Mutex
	saveTimer *time.Timer
	saveErr   string

	// The native page view for the browser dialog. Created on first use, then reused.
	paneMu sync.Mutex
	pane   *webpane.Pane
}

// NewApp builds the backend. Wails calls startup once the window exists.
func NewApp() *App {
	a := &App{}
	a.mgr = agent.New(a.emitBatch, a.scheduleSave)
	a.terms = terminal.New(a.emitTerminalOutput, a.emitTerminalExit)
	return a
}

// GetLimits returns each provider's usage allowance (the 5-hour and weekly windows). The CLIs are
// asked at most every few minutes; force asks them now.
func (a *App) GetLimits(force bool) []model.ProviderLimits {
	ctx := a.ctx
	if ctx == nil {
		ctx = context.Background()
	}
	return a.limits.Get(ctx, force)
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
	a.mgr.SetAttachmentDir(filepath.Join(filepath.Dir(path), "attachments"))
	// Agents get the browser tool by running this executable with the browser MCP flag.
	if exe, err := os.Executable(); err == nil {
		a.mgr.SetBrowserCommand(exe)
	}
	st, err := store.Load(path)
	if err != nil {
		a.loadErr = err.Error()
	}
	a.mgr.Load(st)
	go a.runSchedule(ctx)
}

func (a *App) shutdown(context.Context) {
	a.terms.CloseAll()
	a.saveNow()
}

func (a *App) emitTerminalOutput(id, data string) {
	if a.ctx != nil {
		a.wails.Event.Emit(terminalOutputEvent, TerminalOutput{ID: id, Data: data})
	}
}

func (a *App) emitTerminalExit(id string) {
	if a.ctx != nil {
		a.wails.Event.Emit(terminalExitEvent, map[string]string{"id": id})
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
	a.wails.Event.Emit(eventName, batch)
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
	Automations  []model.Automation     `json:"automations"`
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
		Automations:  a.mgr.Automations(),
		Providers:    provider.Infos(),
		StatePath:    a.statePath,
		StorageError: storageErr,
		Version:      release.Version,
	}
}

// ---- automations ----------------------------------------------------------

// runSchedule launches due automations until the app shuts down.
func (a *App) runSchedule(ctx context.Context) {
	ticker := time.NewTicker(automationTick)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case now := <-ticker.C:
			if a.mgr.RunDueAutomations(now) > 0 {
				a.emitAutomations(a.mgr.Automations())
			}
		}
	}
}

// emitAutomations sends the full automation list to the window. The UI keeps no copy of its own.
func (a *App) emitAutomations(list []model.Automation) {
	if a.ctx == nil || list == nil {
		return
	}
	a.wails.Event.Emit(automationsEvent, list)
}

// SaveAutomation creates an automation, or updates the one whose ID is set.
func (a *App) SaveAutomation(auto model.Automation) error {
	list, err := a.mgr.SaveAutomation(auto)
	a.emitAutomations(list)
	return err
}

// DeleteAutomation removes an automation. Agents it already launched stay.
func (a *App) DeleteAutomation(id string) error {
	list, err := a.mgr.DeleteAutomation(id)
	a.emitAutomations(list)
	return err
}

// RunAutomation starts the automation's agent now, outside its schedule.
func (a *App) RunAutomation(id string) error {
	list, err := a.mgr.RunAutomation(id)
	a.emitAutomations(list)
	return err
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

// ---- git ------------------------------------------------------------------

// GetGitStatus lists the project's branch and uncommitted changes.
func (a *App) GetGitStatus(projectID string) (gitdiff.RepoStatus, error) {
	repo, err := a.mgr.ProjectRepo(projectID)
	if err != nil {
		return gitdiff.RepoStatus{}, err
	}
	return gitdiff.Status(repo)
}

// GetGitDiff returns the diff for one changed path. staged picks the index side.
func (a *App) GetGitDiff(projectID, path string, staged, untracked bool) (string, error) {
	repo, err := a.mgr.ProjectRepo(projectID)
	if err != nil {
		return "", err
	}
	return gitdiff.Diff(repo, path, staged, untracked)
}

// GetGitLog returns the most recent commits.
func (a *App) GetGitLog(projectID string) ([]gitdiff.CommitInfo, error) {
	repo, err := a.mgr.ProjectRepo(projectID)
	if err != nil {
		return nil, err
	}
	return gitdiff.Log(repo, 30)
}

// StageFiles adds paths to the index.
func (a *App) StageFiles(projectID string, paths []string) error {
	repo, err := a.mgr.ProjectRepo(projectID)
	if err != nil {
		return err
	}
	return gitdiff.Stage(repo, paths)
}

// UnstageFiles removes paths from the index and keeps their edits.
func (a *App) UnstageFiles(projectID string, paths []string) error {
	repo, err := a.mgr.ProjectRepo(projectID)
	if err != nil {
		return err
	}
	return gitdiff.Unstage(repo, paths)
}

// CommitChanges commits paths (or the whole index when paths is empty) and returns the short hash.
func (a *App) CommitChanges(projectID, message string, paths []string) (string, error) {
	repo, err := a.mgr.ProjectRepo(projectID)
	if err != nil {
		return "", err
	}
	return gitdiff.Commit(repo, message, paths)
}

// SetProjectAutoCommit turns auto-commit on or off for a project.
func (a *App) SetProjectAutoCommit(projectID string, on bool) error {
	return a.mgr.SetProjectAutoCommit(projectID, on)
}

// BrowserFetch loads a web page for the built-in browser. The address may omit https://.
// A page that answers with an error status still comes back, with that status.
func (a *App) BrowserFetch(address string) (browser.Page, error) {
	ctx := a.ctx
	if ctx == nil {
		ctx = context.Background()
	}
	ctx, cancel := context.WithTimeout(ctx, browser.DefaultTimeout+5*time.Second)
	defer cancel()
	return browser.Fetch(ctx, address)
}

// CheckForUpdate asks GitHub for the newest published Orbit release. It returns an error when
// GitHub cannot be reached, and release.ErrNoRelease when nothing has been published yet.
func (a *App) CheckForUpdate() (model.ReleaseInfo, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	return release.Latest(ctx, &http.Client{})
}

// BrowserOpenExternal opens a web address in the user's default browser, for pages the
// built-in view cannot show well.
func (a *App) BrowserOpenExternal(address string) error {
	if a.ctx == nil {
		return errors.New("the window is not ready yet")
	}
	u, err := browser.ParseURL(address)
	if err != nil {
		return err
	}
	return a.wails.Browser.OpenURL(u.String())
}

// BrowserPaneSupported reports whether the browser dialog can show real web pages here.
// When it cannot, the dialog uses the text view.
func (a *App) BrowserPaneSupported() bool {
	return webpane.Supported()
}

// BrowserPaneOpen shows the page view over a rectangle of the window, in physical pixels, and
// loads address when one is given. The view is created on first use and reused afterwards.
func (a *App) BrowserPaneOpen(address string, x, y, w, h int) error {
	a.paneMu.Lock()
	defer a.paneMu.Unlock()
	if a.pane == nil {
		p, err := webpane.Open(a.emitPaneState)
		if err != nil {
			return err
		}
		a.pane = p
	}
	a.pane.SetBounds(x, y, w, h)
	a.pane.Show()
	if address == "" {
		return nil
	}
	u, err := browser.ParseURL(address)
	if err != nil {
		return err
	}
	a.pane.Navigate(u.String())
	return nil
}

// BrowserPaneNavigate loads an address in the page view. The address may omit https://.
func (a *App) BrowserPaneNavigate(address string) error {
	a.paneMu.Lock()
	defer a.paneMu.Unlock()
	if a.pane == nil {
		return errors.New("the page view is not open")
	}
	u, err := browser.ParseURL(address)
	if err != nil {
		return err
	}
	a.pane.Navigate(u.String())
	return nil
}

// BrowserPaneSetBounds moves and resizes the page view, in physical pixels relative to the window.
func (a *App) BrowserPaneSetBounds(x, y, w, h int) {
	a.paneMu.Lock()
	defer a.paneMu.Unlock()
	if a.pane != nil {
		a.pane.SetBounds(x, y, w, h)
	}
}

// BrowserPaneBack goes back in the page view's history.
func (a *App) BrowserPaneBack() {
	a.withPane(func(p *webpane.Pane) { p.Back() })
}

// BrowserPaneForward goes forward in the page view's history.
func (a *App) BrowserPaneForward() {
	a.withPane(func(p *webpane.Pane) { p.Forward() })
}

// BrowserPaneReload loads the current page again.
func (a *App) BrowserPaneReload() {
	a.withPane(func(p *webpane.Pane) { p.Reload() })
}

// BrowserPaneStop cancels the page's pending loads.
func (a *App) BrowserPaneStop() {
	a.withPane(func(p *webpane.Pane) { p.Stop() })
}

// BrowserPaneHide hides the page view but keeps the page, so reopening the browser is instant.
func (a *App) BrowserPaneHide() {
	a.withPane(func(p *webpane.Pane) { p.Hide() })
}

// BrowserPaneClose destroys the page view and frees its engine.
func (a *App) BrowserPaneClose() {
	a.paneMu.Lock()
	defer a.paneMu.Unlock()
	if a.pane != nil {
		a.pane.Close()
		a.pane = nil
	}
}

func (a *App) withPane(f func(*webpane.Pane)) {
	a.paneMu.Lock()
	defer a.paneMu.Unlock()
	if a.pane != nil {
		f(a.pane)
	}
}

// emitPaneState sends the page view's state to the frontend. It may be called from the view's thread.
func (a *App) emitPaneState(ev webpane.Event) {
	if a.ctx != nil {
		a.wails.Event.Emit("browser:pane", ev)
	}
}

// ---- ssh ----------------------------------------------------------------------

// ListSSHProfiles returns the saved SSH connections, oldest first.
func (a *App) ListSSHProfiles() []model.SSHProfile {
	return a.mgr.SSHProfiles()
}

// SaveSSHProfile creates or updates an SSH connection. It returns the stored profile.
func (a *App) SaveSSHProfile(p model.SSHProfile) (model.SSHProfile, error) {
	prof, err := a.mgr.SaveSSHProfile(p)
	if err == nil {
		a.scheduleSave()
	}
	return prof, err
}

// DeleteSSHProfile removes a saved SSH connection.
func (a *App) DeleteSSHProfile(id string) error {
	err := a.mgr.DeleteSSHProfile(id)
	if err == nil {
		a.scheduleSave()
	}
	return err
}

// TestSSHProfile opens the saved connection and runs a trivial command.
func (a *App) TestSSHProfile(id string) error {
	ctx := a.ctx
	if ctx == nil {
		ctx = context.Background()
	}
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	return a.mgr.TestSSHProfile(ctx, id)
}

// RunSSHCommand runs command on a saved connection and returns its output.
func (a *App) RunSSHCommand(id, command string) (string, error) {
	ctx := a.ctx
	if ctx == nil {
		ctx = context.Background()
	}
	ctx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()
	return a.mgr.RunSSHCommand(ctx, id, command)
}

// PickRepository opens a native folder picker. It returns "" when cancelled.
func (a *App) PickRepository() (string, error) {
	if a.ctx == nil {
		return "", errors.New("the window is not ready yet")
	}
	return a.wails.Dialog.OpenFileWithOptions(&application.OpenFileDialogOptions{
		Title: "Choose the project's repository folder", CanChooseDirectories: true,
	}).PromptForSingleSelection()
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

// ListProjectFiles lists the entries in one directory of a project's repository.
// Used by the chat @-mention autocomplete.
func (a *App) ListProjectFiles(projectID, relPath string) ([]string, error) {
	return a.mgr.ListFiles(projectID, relPath)
}

// ProjectBranches lists a project's git branches for the launch dialog.
func (a *App) ProjectBranches(projectID string) (model.BranchInfo, error) {
	return a.mgr.ProjectBranches(projectID)
}

// SendMessage sends a message with optional images, starting a new turn.
func (a *App) SendMessage(agentID, text string, images []model.ImageUpload) error {
	return a.mgr.Send(agentID, text, images)
}

// AttachmentImage returns a chat image as a data URL.
func (a *App) AttachmentImage(agentID, attachmentID string) (string, error) {
	return a.mgr.AttachmentImage(agentID, attachmentID)
}

// DelegateTask asks agent toID to carry out task on behalf of fromID. The galaxy draws the handoff as a beam.
func (a *App) DelegateTask(fromID, toID, task string) (model.Handoff, error) {
	return a.mgr.Delegate(fromID, toID, task)
}

// StartConversation makes two agents in one project talk to each other about topic, passing
// each reply to the other, for up to maxReplies replies.
func (a *App) StartConversation(aID, bID, topic string, maxReplies int) (model.Conversation, error) {
	return a.mgr.StartConversation(aID, bID, topic, maxReplies)
}

// Communicate makes two agents in one project work together on a task, passing each reply to
// the other until the task is finished or the reply limit is reached.
func (a *App) Communicate(aID, bID, topic string, maxReplies int) (model.Conversation, error) {
	return a.mgr.Communicate(aID, bID, topic, maxReplies)
}

// Collaborate makes two agents work together on a shared task.
func (a *App) Collaborate(aID, bID, task string, maxReplies int) (model.Conversation, error) {
	return a.mgr.Collaborate(aID, bID, task, maxReplies)
}

// LaunchPair creates two agents in one project (first opens) and starts them working together on task.
func (a *App) LaunchPair(first, partner agent.LaunchRequest, task string, maxReplies int) (model.Conversation, error) {
	return a.mgr.LaunchPair(first, partner, task, maxReplies)
}

// LaunchTeam creates the first agent and its partners in one project and starts them working together on task.
func (a *App) LaunchTeam(first agent.LaunchRequest, partners []agent.LaunchRequest, task string, maxReplies int) (model.Conversation, error) {
	return a.mgr.LaunchTeam(first, partners, task, maxReplies)
}

// StartTeam makes the given agents (in speaking order) work together on topic.
func (a *App) StartTeam(agentIDs []string, topic string, maxReplies int) (model.Conversation, error) {
	return a.mgr.StartTeam(agentIDs, topic, maxReplies)
}

// Relay hands a message from one agent to another and asks the receiver to act on it.
func (a *App) Relay(fromID, toID, message string) (model.Handoff, error) {
	return a.mgr.Relay(fromID, toID, message)
}

// StopConversation ends an agent-to-agent talk and cancels the reply in progress.
func (a *App) StopConversation(id string) error {
	return a.mgr.StopConversation(id)
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

// AcknowledgeAgent clears the completed mark on an agent the user has opened.
func (a *App) AcknowledgeAgent(agentID string) error {
	return a.mgr.Acknowledge(agentID)
}

// RenameAgent changes an agent's display name.
func (a *App) RenameAgent(agentID, name string) error {
	return a.mgr.Rename(agentID, name)
}

// SetAgentModel changes the model, thinking effort, fast mode and ultrafast mode an agent uses from its next turn.
func (a *App) SetAgentModel(agentID, modelID, effort string, fastMode, ultraFast bool) (model.AgentSummary, error) {
	return a.mgr.SetModel(agentID, modelID, effort, fastMode, ultraFast)
}

// SetAgentBranch moves an agent to another branch of its project's repository from its next message.
func (a *App) SetAgentBranch(agentID, branch string) (model.AgentSummary, error) {
	return a.mgr.SetBranch(agentID, branch)
}

// SetAgentPermission changes an agent's permission mode from its next message.
func (a *App) SetAgentPermission(agentID, mode string) (model.AgentSummary, error) {
	return a.mgr.SetPermissionMode(agentID, mode)
}

// SetAgentPosition stores where the user placed an agent.
func (a *App) SetAgentPosition(agentID string, x, y float64) error {
	return a.mgr.SetPosition(agentID, x, y)
}
