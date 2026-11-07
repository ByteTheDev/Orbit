package agent

import (
	"testing"

	"orbit/internal/model"
	"orbit/internal/provider"
)

func TestCommunicationCompletesOnDoneMarker(t *testing.T) {
	m, _, _ := newTestManager(t)
	m.providers["fake"] = fakeProvider{script: []provider.Update{
		{Kind: provider.UpdMessage, ID: "m", Role: "assistant", Text: "finished [[DONE]]"},
		{Kind: provider.UpdTurnDone, Success: true},
	}}
	proj, _ := m.CreateProject("Collab", t.TempDir())
	a, _ := m.Launch(LaunchRequest{ProjectID: proj.ID, Provider: "fake", Name: "Claude", Task: "x"})
	b, _ := m.Launch(LaunchRequest{ProjectID: proj.ID, Provider: "fake", Name: "GPT", Task: "y"})
	waitIdle(t, m, a.ID)
	waitIdle(t, m, b.ID)

	c, err := m.Communicate(a.ID, b.ID, "finish the task", 5)
	if err != nil {
		t.Fatalf("communicate: %v", err)
	}
	done := waitConversation(t, m, proj.ID, c.ID)
	if done.Status != model.ConvDone || done.Replies != 1 {
		t.Fatalf("want done after one reply, got %+v", done)
	}
}