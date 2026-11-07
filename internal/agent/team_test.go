package agent

import (
	"testing"

	"orbit/internal/model"
	"orbit/internal/provider"
)

func TestTeamTalkPassesRepliesRoundTheRing(t *testing.T) {
	m, _, _ := newTestManager(t)
	m.providers["fake"] = fakeProvider{script: []provider.Update{
		{Kind: provider.UpdMessage, ID: "m", Role: "assistant", Text: "my view"},
		{Kind: provider.UpdTurnDone, Success: true},
	}}
	proj, _ := m.CreateProject("Team", t.TempDir())

	c, err := m.LaunchTeam(
		LaunchRequest{ProjectID: proj.ID, Provider: "fake", Name: "Alpha"},
		[]LaunchRequest{
			{ProjectID: proj.ID, Provider: "fake", Name: "Beta"},
			{ProjectID: proj.ID, Provider: "fake", Name: "Gamma"},
		},
		"review the parser", 4,
	)
	if err != nil {
		t.Fatalf("launch team: %v", err)
	}
	if len(c.Members) != 3 {
		t.Fatalf("want three members, got %+v", c.Members)
	}

	done := waitConversation(t, m, proj.ID, c.ID)
	if done.Status != model.ConvDone || done.Replies != 4 {
		t.Fatalf("want done after 4 replies, got %+v", done)
	}
	// Alpha opens, then Beta, Gamma, and Alpha again: the reply order wraps round the ring.
	want := []string{"Alpha", "Beta", "Gamma", "Alpha"}
	if len(done.Lines) != len(want)+1 {
		t.Fatalf("want the topic plus %d replies, got %d lines", len(want), len(done.Lines))
	}
	for i, name := range want {
		if done.Lines[i+1].Name != name {
			t.Fatalf("reply %d should be from %s, got %s", i+1, name, done.Lines[i+1].Name)
		}
	}
}

func TestTeamNeedsAtLeastOnePartner(t *testing.T) {
	m, _, _ := newTestManager(t)
	proj, _ := m.CreateProject("Solo", t.TempDir())
	if _, err := m.LaunchTeam(LaunchRequest{ProjectID: proj.ID, Provider: "fake"}, nil, "task", 4); err == nil {
		t.Fatal("a team with no partner must be refused")
	}
}

func TestNextMemberWrapsRound(t *testing.T) {
	c := &model.Conversation{Members: []string{"a", "b", "c"}}
	if got := nextMemberID(c, "a"); got != "b" {
		t.Fatalf("after a want b, got %s", got)
	}
	if got := nextMemberID(c, "c"); got != "a" {
		t.Fatalf("after c want a, got %s", got)
	}
}
