package agent

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"orbit/internal/model"
	"orbit/internal/provider"
	"orbit/internal/store"
)

// fakeProvider replays a fixed script, or blocks until cancelled when block is set.
type fakeProvider struct {
	script []provider.Update
	block  bool
}

func (f fakeProvider) ID() string                 { return "fake" }
func (f fakeProvider) Name() string               { return "Fake" }
func (f fakeProvider) Detect() provider.Detection { return provider.Detection{Available: true} }
func (f fakeProvider) Capabilities() model.Capabilities {
	return model.Capabilities{Stop: true, Resume: true, Send: true,
		PermissionModes: []model.PermissionMode{{ID: "m", Label: "m"}}}
}
func (f fakeProvider) Run(ctx context.Context, spec provider.Spec, emit func(provider.Update)) error {
	if f.block {
		<-ctx.Done()
		return ctx.Err()
	}
	for _, u := range f.script {
		emit(u)
	}
	return nil
}

func newTestManager(t *testing.T) (*Manager, *[]model.Event, *sync.Mutex) {
	t.Helper()
	var mu sync.Mutex
	var events []model.Event
	m := New(func(batch []model.Event) {
		mu.Lock()
		events = append(events, batch...)
		mu.Unlock()
	}, func() {})
	return m, &events, &mu
}

func waitIdle(t *testing.T, m *Manager, id string) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		d, err := m.Detail(id)
		if err != nil {
			t.Fatal(err)
		}
		if !d.Running {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("agent did not finish in time")
}

func TestTurnLifecycleRecordsMessagesFilesAndStatus(t *testing.T) {
	m, events, mu := newTestManager(t)
	m.providers["fake"] = fakeProvider{script: []provider.Update{
		{Kind: provider.UpdSession, ID: "sess-1", Text: "model-x"},
		{Kind: provider.UpdStatus, Status: model.StatusWriting, Detail: "Editing"},
		{Kind: provider.UpdMessageStart, ID: "m1", Role: "assistant"},
		{Kind: provider.UpdMessageDelta, ID: "m1", Text: "Hello "},
		{Kind: provider.UpdMessageDelta, ID: "m1", Text: "world"},
		{Kind: provider.UpdMessageEnd, ID: "m1"},
		{Kind: provider.UpdToolStart, Tool: &model.ToolCall{ID: "t1", Name: "Edit", Summary: "x"}},
		{Kind: provider.UpdFile, File: &provider.FileTouch{Path: "src/App.tsx", Op: "write", Tool: "Edit", Diff: "+ a", Phase: "start"}},
		{Kind: provider.UpdFile, File: &provider.FileTouch{Path: "src/App.tsx", Op: "write", Tool: "Edit", Phase: "end"}},
		{Kind: provider.UpdToolEnd, ToolID: "t1", Output: "ok"},
		{Kind: provider.UpdUsage, InTokens: 10, OutTokens: 5},
		{Kind: provider.UpdTurnDone, Success: true, Text: "Hello world"},
	}}

	proj, err := m.CreateProject("Demo", t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	sum, err := m.Launch(LaunchRequest{ProjectID: proj.ID, Provider: "fake", Task: "do it"})
	if err != nil {
		t.Fatal(err)
	}
	waitIdle(t, m, sum.ID)

	d, err := m.Detail(sum.ID)
	if err != nil {
		t.Fatal(err)
	}
	if d.Status != model.StatusCompleted {
		t.Fatalf("status = %s, want completed", d.Status)
	}
	if d.SessionID != "sess-1" {
		t.Fatalf("session = %q", d.SessionID)
	}
	if len(d.Messages) != 2 || d.Messages[1].Text != "Hello world" || d.Messages[1].Streaming {
		t.Fatalf("messages wrong: %+v", d.Messages)
	}
	if len(d.Files) != 1 || d.Files[0].Writes != 1 || d.Files[0].State != "recent" {
		t.Fatalf("files wrong: %+v", d.Files)
	}
	if d.Usage.InputTokens != 10 || d.Usage.OutputTokens != 5 {
		t.Fatalf("usage wrong: %+v", d.Usage)
	}
	if len(d.Tools) != 1 || d.Tools[0].Status != "ok" {
		t.Fatalf("tools wrong: %+v", d.Tools)
	}

	// Batches are flushed asynchronously; wait briefly for the summary to arrive.
	time.Sleep(3 * flushDelay)
	mu.Lock()
	defer mu.Unlock()
	var sawDelta, sawAgent bool
	for _, e := range *events {
		if e.Type == "delta" {
			sawDelta = true
		}
		if e.Type == "agent" && e.Agent != nil && e.Agent.Status == model.StatusCompleted {
			sawAgent = true
		}
	}
	if !sawDelta || !sawAgent {
		t.Fatalf("expected delta and completed agent events, got %d events", len(*events))
	}
}

func TestConflictsAppearWhenTwoAgentsWriteSameFile(t *testing.T) {
	m, _, _ := newTestManager(t)
	write := []provider.Update{
		{Kind: provider.UpdFile, File: &provider.FileTouch{Path: "src/App.tsx", Op: "write", Phase: "start"}},
		{Kind: provider.UpdFile, File: &provider.FileTouch{Path: "src/App.tsx", Op: "write", Phase: "end"}},
		{Kind: provider.UpdTurnDone, Success: true},
	}
	m.providers["fake"] = fakeProvider{script: write}
	proj, _ := m.CreateProject("Shared", t.TempDir())
	a, _ := m.Launch(LaunchRequest{ProjectID: proj.ID, Provider: "fake", Name: "Alpha", Task: "x"})
	b, _ := m.Launch(LaunchRequest{ProjectID: proj.ID, Provider: "fake", Name: "Beta", Task: "y"})
	waitIdle(t, m, a.ID)
	waitIdle(t, m, b.ID)

	projects := m.Projects()
	if len(projects) != 1 || len(projects[0].Conflicts) != 1 {
		t.Fatalf("expected one conflict, got %+v", projects)
	}
	c := projects[0].Conflicts[0]
	if c.Path != "src/App.tsx" || len(c.Agents) != 2 {
		t.Fatalf("unexpected conflict %+v", c)
	}
}

func TestStopCancelsRunningTurn(t *testing.T) {
	m, _, _ := newTestManager(t)
	m.providers["fake"] = fakeProvider{block: true}
	proj, _ := m.CreateProject("Slow", t.TempDir())
	sum, err := m.Launch(LaunchRequest{ProjectID: proj.ID, Provider: "fake", Task: "wait"})
	if err != nil {
		t.Fatal(err)
	}
	if err := m.Stop(sum.ID); err != nil {
		t.Fatalf("stop: %v", err)
	}
	waitIdle(t, m, sum.ID)
	d, _ := m.Detail(sum.ID)
	if d.Status != model.StatusStopped {
		t.Fatalf("status = %s, want stopped", d.Status)
	}
	if err := m.Stop(sum.ID); !errors.Is(err, ErrIdle) {
		t.Fatalf("second stop should report idle, got %v", err)
	}
}

func TestLoadMarksInterruptedAgentsStopped(t *testing.T) {
	m, _, _ := newTestManager(t)
	m.Load(store.State{
		Projects: []model.Project{{ID: "p", Name: "P", RepoPath: t.TempDir()}},
		Agents: []model.AgentRecord{{
			ID: "a", ProjectID: "p", Provider: "fake", Running: true, Status: model.StatusWriting,
		}},
	})
	d, err := m.Detail("a")
	if err != nil {
		t.Fatal(err)
	}
	if d.Running || d.Status != model.StatusStopped {
		t.Fatalf("interrupted agent should be stopped and not running: %+v", d.AgentSummary)
	}
}

// An agent with no history must still serialise every collection as [], never null:
// the frontend iterates these arrays directly.
func TestDetailSerialisesEmptyCollectionsAsArrays(t *testing.T) {
	m, _, _ := newTestManager(t)
	m.Load(store.State{
		Projects: []model.Project{{ID: "p", Name: "P", RepoPath: t.TempDir()}},
		Agents:   []model.AgentRecord{{ID: "a", ProjectID: "p", Provider: "fake", Status: model.StatusIdle}},
	})
	d, err := m.Detail("a")
	if err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(d)
	if err != nil {
		t.Fatal(err)
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(raw, &fields); err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"messages", "tools", "activity", "issues", "files"} {
		if string(fields[key]) != "[]" {
			t.Errorf("%s = %s, want []", key, fields[key])
		}
	}
}

func TestSetProjectIcon(t *testing.T) {
	m, _, _ := newTestManager(t)
	proj, err := m.CreateProject("SuperStar", t.TempDir())
	if err != nil {
		t.Fatal(err)
	}

	if err := m.SetProjectIcon(proj.ID, " ★ "); err != nil {
		t.Fatal(err)
	}
	if got := m.Projects()[0].Icon; got != "★" {
		t.Fatalf("icon = %q, want trimmed ★", got)
	}

	if err := m.SetProjectIcon(proj.ID, "toolong"); err == nil {
		t.Fatal("expected an error for an icon longer than the limit")
	}
	if got := m.Projects()[0].Icon; got != "★" {
		t.Fatalf("rejected icon changed the project: %q", got)
	}

	if err := m.SetProjectIcon(proj.ID, ""); err != nil {
		t.Fatal(err)
	}
	if got := m.Projects()[0].Icon; got != "" {
		t.Fatalf("empty icon should restore the default, got %q", got)
	}

	if err := m.SetProjectIcon("missing", "A"); err == nil {
		t.Fatal("expected an error for an unknown project")
	}
}

func TestRenameAgentTrimsAndValidates(t *testing.T) {
	m, _, _ := newTestManager(t)
	m.providers["fake"] = fakeProvider{}

	proj, err := m.CreateProject("Demo", t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	sum, err := m.Launch(LaunchRequest{ProjectID: proj.ID, Provider: "fake"})
	if err != nil {
		t.Fatal(err)
	}

	if err := m.Rename(sum.ID, "  Scout  "); err != nil {
		t.Fatal(err)
	}
	if got := m.Agents()[0].Name; got != "Scout" {
		t.Fatalf("name = %q, want %q", got, "Scout")
	}
	if err := m.Rename(sum.ID, "   "); err == nil {
		t.Fatal("empty name accepted")
	}
	if err := m.Rename(sum.ID, strings.Repeat("x", 61)); err == nil {
		t.Fatal("61-character name accepted")
	}
	if err := m.Rename("missing", "Name"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("unknown agent: err = %v, want ErrNotFound", err)
	}
}

// modelProvider is a fake that offers a fixed model list.
type modelProvider struct{ fakeProvider }

func (modelProvider) Capabilities() model.Capabilities {
	caps := fakeProvider{}.Capabilities()
	caps.Models = []model.ModelOption{{ID: "good-model", Label: "Good", Group: "Current"}}
	return caps
}

func TestLaunchRejectsModelsOutsideTheList(t *testing.T) {
	m, _, _ := newTestManager(t)
	m.providers["fake"] = modelProvider{}
	proj, err := m.CreateProject("Models", t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := m.Launch(LaunchRequest{ProjectID: proj.ID, Provider: "fake", Model: "bad-model"}); err == nil {
		t.Fatal("expected an error for a model outside the list")
	}
	if _, err := m.Launch(LaunchRequest{ProjectID: proj.ID, Provider: "fake", Model: "good-model"}); err != nil {
		t.Fatalf("listed model rejected: %v", err)
	}
	if _, err := m.Launch(LaunchRequest{ProjectID: proj.ID, Provider: "fake"}); err != nil {
		t.Fatalf("empty model (provider default) rejected: %v", err)
	}
}
