package agent

import (
	"testing"

	"orbit/internal/model"
	"orbit/internal/provider"
)

func TestDelegateRecordsHandoffUntilReceiverFinishes(t *testing.T) {
	m, _, _ := newTestManager(t)
	m.providers["fake"] = fakeProvider{script: []provider.Update{{Kind: provider.UpdTurnDone, Success: true}}}
	proj, _ := m.CreateProject("Handoff", t.TempDir())
	a, _ := m.Launch(LaunchRequest{ProjectID: proj.ID, Provider: "fake", Name: "Alpha", Task: "x"})
	b, _ := m.Launch(LaunchRequest{ProjectID: proj.ID, Provider: "fake", Name: "Beta", Task: "y"})
	waitIdle(t, m, a.ID)
	waitIdle(t, m, b.ID)

	h, err := m.Delegate(a.ID, b.ID, "  write the tests  ")
	if err != nil {
		t.Fatalf("delegate: %v", err)
	}
	if h.Status != model.HandoffActive || h.Task != "write the tests" || h.ToID != b.ID {
		t.Fatalf("unexpected handoff %+v", h)
	}
	waitIdle(t, m, b.ID)

	hs := m.Projects()[0].Handoffs
	if len(hs) != 1 || hs[0].Status != model.HandoffDone || hs[0].DoneAt == 0 {
		t.Fatalf("expected one settled handoff, got %+v", hs)
	}
}

func TestDelegateRejectsSelfAndOtherProjects(t *testing.T) {
	m, _, _ := newTestManager(t)
	m.providers["fake"] = fakeProvider{}
	p1, _ := m.CreateProject("One", t.TempDir())
	p2, _ := m.CreateProject("Two", t.TempDir())
	a, _ := m.Launch(LaunchRequest{ProjectID: p1.ID, Provider: "fake", Name: "Alpha", Task: "x"})
	c, _ := m.Launch(LaunchRequest{ProjectID: p2.ID, Provider: "fake", Name: "Gamma", Task: "z"})
	waitIdle(t, m, a.ID)
	waitIdle(t, m, c.ID)

	if _, err := m.Delegate(a.ID, a.ID, "self"); err != ErrOtherProject {
		t.Fatalf("self delegation: want ErrOtherProject, got %v", err)
	}
	if _, err := m.Delegate(a.ID, c.ID, "cross"); err != ErrOtherProject {
		t.Fatalf("cross-project delegation: want ErrOtherProject, got %v", err)
	}
	if _, err := m.Delegate(a.ID, c.ID, "   "); err == nil {
		t.Fatal("empty task should be rejected")
	}
}

func TestProjectWithoutHandoffsSerialisesAsEmptyArray(t *testing.T) {
	m, _, _ := newTestManager(t)
	proj, _ := m.CreateProject("Quiet", t.TempDir())
	ps := m.Projects()
	if ps[0].ID != proj.ID || ps[0].Handoffs == nil {
		t.Fatalf("handoffs must be a non-nil empty slice, got %+v", ps[0].Handoffs)
	}
}
