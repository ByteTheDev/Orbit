package agent

import (
	"testing"
	"time"

	"orbit/internal/model"
	"orbit/internal/provider"
)

// waitConversation polls until the talk leaves the active state, or fails the test.
func waitConversation(t *testing.T, m *Manager, projectID, id string) model.Conversation {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		for _, p := range m.Projects() {
			if p.ID != projectID {
				continue
			}
			for _, c := range p.Conversations {
				if c.ID == id && c.Status != model.ConvActive {
					return c
				}
			}
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("conversation %s never finished", id)
	return model.Conversation{}
}

func TestConversationRelaysRepliesUntilLimit(t *testing.T) {
	m, _, _ := newTestManager(t)
	m.providers["fake"] = fakeProvider{script: []provider.Update{
		{Kind: provider.UpdMessage, ID: "m", Role: "assistant", Text: "my view"},
		{Kind: provider.UpdTurnDone, Success: true},
	}}
	proj, _ := m.CreateProject("Talk", t.TempDir())
	a, _ := m.Launch(LaunchRequest{ProjectID: proj.ID, Provider: "fake", Name: "Alpha", Task: "x"})
	b, _ := m.Launch(LaunchRequest{ProjectID: proj.ID, Provider: "fake", Name: "Beta", Task: "y"})
	waitIdle(t, m, a.ID)
	waitIdle(t, m, b.ID)

	c, err := m.StartConversation(a.ID, b.ID, "  naming the module  ", 3)
	if err != nil {
		t.Fatalf("start: %v", err)
	}
	if c.Topic != "naming the module" || c.NextID != a.ID || c.MaxReplies != 3 {
		t.Fatalf("unexpected conversation %+v", c)
	}
	done := waitConversation(t, m, proj.ID, c.ID)
	if done.Status != model.ConvDone || done.Replies != 3 {
		t.Fatalf("want done after 3 replies, got %+v", done)
	}
	// Each side's reply was relayed, so both chats hold the prompts they were sent.
	da, _ := m.Detail(a.ID)
	db, _ := m.Detail(b.ID)
	if len(da.Messages) < 2 || len(db.Messages) < 2 {
		t.Fatalf("both agents should have received relayed prompts: a=%d b=%d", len(da.Messages), len(db.Messages))
	}
}

func TestConversationStopCancelsReplyInProgress(t *testing.T) {
	m, _, _ := newTestManager(t)
	m.providers["fake"] = fakeProvider{block: true}
	proj, _ := m.CreateProject("Stop", t.TempDir())
	a, _ := m.Launch(LaunchRequest{ProjectID: proj.ID, Provider: "fake", Name: "Alpha"})
	b, _ := m.Launch(LaunchRequest{ProjectID: proj.ID, Provider: "fake", Name: "Beta"})
	c, err := m.StartConversation(a.ID, b.ID, "anything", 0)
	if err != nil {
		t.Fatalf("start: %v", err)
	}
	if err := m.StopConversation(c.ID); err != nil {
		t.Fatalf("stop: %v", err)
	}
	done := waitConversation(t, m, proj.ID, c.ID)
	if done.Status != model.ConvStopped {
		t.Fatalf("want stopped, got %+v", done)
	}
	waitIdle(t, m, a.ID)
	if err := m.StopConversation(c.ID); err == nil {
		t.Fatal("stopping a finished talk should fail")
	}
}

func TestConversationEndsWhenTurnFails(t *testing.T) {
	m, _, _ := newTestManager(t)
	m.providers["fake"] = fakeProvider{script: []provider.Update{
		{Kind: provider.UpdTurnDone, Success: false, Text: "boom"},
	}}
	proj, _ := m.CreateProject("Fail", t.TempDir())
	a, _ := m.Launch(LaunchRequest{ProjectID: proj.ID, Provider: "fake", Name: "Alpha", Task: "x"})
	b, _ := m.Launch(LaunchRequest{ProjectID: proj.ID, Provider: "fake", Name: "Beta", Task: "y"})
	waitIdle(t, m, a.ID)
	waitIdle(t, m, b.ID)
	c, err := m.StartConversation(a.ID, b.ID, "trouble", 4)
	if err != nil {
		t.Fatalf("start: %v", err)
	}
	done := waitConversation(t, m, proj.ID, c.ID)
	if done.Status != model.ConvFailed || done.Error == "" {
		t.Fatalf("want failed with a reason, got %+v", done)
	}
}

func TestStartConversationValidatesInput(t *testing.T) {
	m, _, _ := newTestManager(t)
	m.providers["fake"] = fakeProvider{}
	p1, _ := m.CreateProject("One", t.TempDir())
	p2, _ := m.CreateProject("Two", t.TempDir())
	a, _ := m.Launch(LaunchRequest{ProjectID: p1.ID, Provider: "fake", Name: "Alpha", Task: "x"})
	b, _ := m.Launch(LaunchRequest{ProjectID: p1.ID, Provider: "fake", Name: "Beta", Task: "y"})
	c, _ := m.Launch(LaunchRequest{ProjectID: p2.ID, Provider: "fake", Name: "Gamma", Task: "z"})
	waitIdle(t, m, a.ID)
	waitIdle(t, m, b.ID)
	waitIdle(t, m, c.ID)

	if _, err := m.StartConversation(a.ID, b.ID, "   ", 2); err == nil {
		t.Fatal("empty topic should be rejected")
	}
	if _, err := m.StartConversation(a.ID, a.ID, "self", 2); err != ErrOtherProject {
		t.Fatalf("self talk: want ErrOtherProject, got %v", err)
	}
	if _, err := m.StartConversation(a.ID, c.ID, "cross", 2); err != ErrOtherProject {
		t.Fatalf("cross-project talk: want ErrOtherProject, got %v", err)
	}
}

func TestProjectWithoutConversationsSerialisesAsEmptyArray(t *testing.T) {
	m, _, _ := newTestManager(t)
	m.CreateProject("Quiet", t.TempDir())
	if ps := m.Projects(); ps[0].Conversations == nil {
		t.Fatal("conversations must be a non-nil empty slice")
	}
}
