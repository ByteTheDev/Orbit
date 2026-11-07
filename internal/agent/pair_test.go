package agent

import (
	"strings"
	"testing"

	"orbit/internal/model"
	"orbit/internal/provider"
)

func TestLaunchPairStartsIdleAgentsAndRecordsTranscript(t *testing.T) {
	m, _, _ := newTestManager(t)
	m.providers["fake"] = fakeProvider{script: []provider.Update{
		{Kind: provider.UpdMessage, ID: "m", Role: "assistant", Text: "my view"},
		{Kind: provider.UpdTurnDone, Success: true},
	}}
	proj, _ := m.CreateProject("Pair", t.TempDir())

	c, err := m.LaunchPair(
		LaunchRequest{ProjectID: proj.ID, Provider: "fake", Name: "Alpha"},
		LaunchRequest{ProjectID: proj.ID, Provider: "fake", Name: "Beta"},
		"  split the parser  ", 2,
	)
	if err != nil {
		t.Fatalf("launch pair: %v", err)
	}
	if c.Topic != "split the parser" || c.MaxReplies != 2 {
		t.Fatalf("unexpected conversation %+v", c)
	}
	if len(c.Lines) != 1 || c.Lines[0].AgentID != "" || c.Lines[0].Text != "split the parser" {
		t.Fatalf("the opening topic should be the first line, from the user: %+v", c.Lines)
	}

	done := waitConversation(t, m, proj.ID, c.ID)
	if done.Status != model.ConvDone {
		t.Fatalf("want done, got %+v", done)
	}
	if len(done.Lines) != 3 {
		t.Fatalf("want the topic plus two replies, got %d lines: %+v", len(done.Lines), done.Lines)
	}
	if done.Lines[1].Name != "Alpha" || done.Lines[2].Name != "Beta" {
		t.Fatalf("replies should alternate between the two agents: %+v", done.Lines)
	}
	if done.Lines[1].Text != "my view" || done.Lines[1].Provider != "fake" {
		t.Fatalf("reply text and provider should be recorded: %+v", done.Lines[1])
	}
}

func TestTranscriptStripsDoneMarkerFromReplies(t *testing.T) {
	m, _, _ := newTestManager(t)
	m.providers["fake"] = fakeProvider{script: []provider.Update{
		{Kind: provider.UpdMessage, ID: "m", Role: "assistant", Text: "all finished [[DONE]]"},
		{Kind: provider.UpdTurnDone, Success: true},
	}}
	proj, _ := m.CreateProject("Done", t.TempDir())
	c, err := m.LaunchPair(
		LaunchRequest{ProjectID: proj.ID, Provider: "fake"},
		LaunchRequest{ProjectID: proj.ID, Provider: "fake"},
		"wrap up", 8,
	)
	if err != nil {
		t.Fatalf("launch pair: %v", err)
	}
	done := waitConversation(t, m, proj.ID, c.ID)
	last := done.Lines[len(done.Lines)-1]
	if strings.Contains(last.Text, "[[DONE]]") || last.Text != "all finished" {
		t.Fatalf("the marker should not show in the transcript: %q", last.Text)
	}
}

func TestLaunchPairNeedsATask(t *testing.T) {
	m, _, _ := newTestManager(t)
	proj, _ := m.CreateProject("NoTask", t.TempDir())
	if _, err := m.LaunchPair(LaunchRequest{ProjectID: proj.ID, Provider: "fake"}, LaunchRequest{ProjectID: proj.ID, Provider: "fake"}, "  ", 4); err == nil {
		t.Fatal("a pair without a shared task must be refused")
	}
	if len(m.Projects()) == 0 {
		t.Fatal("project should still exist")
	}
}

func TestPartnerSharesTheFirstAgentsWorkspace(t *testing.T) {
	m, _, _ := newTestManager(t)
	m.providers["fake"] = fakeProvider{script: []provider.Update{{Kind: provider.UpdTurnDone, Success: true}}}
	proj, _ := m.CreateProject("Shared", t.TempDir())
	a, err := m.Launch(LaunchRequest{ProjectID: proj.ID, Provider: "fake", Name: "First"})
	if err != nil {
		t.Fatalf("launch first: %v", err)
	}
	b, err := m.launch(LaunchRequest{ProjectID: proj.ID, Provider: "fake", Name: "Second"}, a.ID)
	if err != nil {
		t.Fatalf("launch partner: %v", err)
	}
	m.mu.Lock()
	wa, wb := m.agents[a.ID].WorkDir, m.agents[b.ID].WorkDir
	ba, bb := m.agents[a.ID].Branch, m.agents[b.ID].Branch
	m.mu.Unlock()
	if wa != wb || ba != bb {
		t.Fatalf("partner should share the workspace: first=%q/%q partner=%q/%q", wa, ba, wb, bb)
	}
	if _, err := m.launch(LaunchRequest{ProjectID: proj.ID, Provider: "fake"}, "nope"); err == nil {
		t.Fatal("sharing with a missing agent must fail")
	}
}
