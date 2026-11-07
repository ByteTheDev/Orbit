package agent

import (
	"testing"
	"time"

	"orbit/internal/provider"
)

func TestSetModelChangesTheNextTurnsModel(t *testing.T) {
	m, _, _ := newTestManager(t)
	got := make(chan provider.Spec, 2)
	m.providers["fake"] = effortProvider{got: got}
	proj, _ := m.CreateProject("Swap", t.TempDir())
	a, err := m.Launch(LaunchRequest{ProjectID: proj.ID, Provider: "fake", Model: "m-plain", Task: "first"})
	if err != nil {
		t.Fatal(err)
	}
	<-got // the first turn

	// Wait for the first turn to finish before changing the model.
	for i := 0; i < 200; i++ {
		if s, _ := m.Detail(a.ID); !s.Running {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}

	sum, err := m.SetModel(a.ID, "m-think", "high", false, false)
	if err != nil {
		t.Fatal(err)
	}
	if sum.Model != "m-think" || sum.Effort != "high" {
		t.Fatalf("summary model=%q effort=%q", sum.Model, sum.Effort)
	}
	if err := m.Send(a.ID, "second", nil); err != nil {
		t.Fatal(err)
	}
	if spec := <-got; spec.Model != "m-think" || spec.Effort != "high" {
		t.Fatalf("next turn used model=%q effort=%q", spec.Model, spec.Effort)
	}
}

func TestSetModelRejectsWhatTheProviderDoesNotOffer(t *testing.T) {
	m, _, _ := newTestManager(t)
	m.providers["fake"] = effortProvider{got: make(chan provider.Spec, 1)}
	proj, _ := m.CreateProject("Swap", t.TempDir())
	a, _ := m.Launch(LaunchRequest{ProjectID: proj.ID, Provider: "fake", Model: "m-plain"})
	if _, err := m.SetModel(a.ID, "nope", "", false, false); err == nil {
		t.Fatal("a model the provider does not offer should be refused")
	}
	if _, err := m.SetModel(a.ID, "m-plain", "high", false, false); err == nil {
		t.Fatal("effort on a model without levels should be refused")
	}
	if _, err := m.SetModel("missing", "m-think", "", false, false); err != ErrNotFound {
		t.Fatalf("unknown agent: err = %v", err)
	}
}

func TestSetModelWorksMidReplyAndKeepsTheRunningTurn(t *testing.T) {
	m, _, _ := newTestManager(t)
	m.providers["fake"] = effortProvider{got: make(chan provider.Spec, 1)}
	proj, _ := m.CreateProject("Mid", t.TempDir())
	a, _ := m.Launch(LaunchRequest{ProjectID: proj.ID, Provider: "fake", Model: "m-plain"})

	// Simulate a reply in progress.
	m.mu.Lock()
	m.agents[a.ID].Running = true
	m.mu.Unlock()

	sum, err := m.SetModel(a.ID, "m-think", "low", false, false)
	if err != nil {
		t.Fatalf("a switch mid-reply should be accepted: %v", err)
	}
	if sum.Model != "m-think" {
		t.Fatalf("model = %q", sum.Model)
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if !m.agents[a.ID].Running {
		t.Fatal("switching the model must not end the reply in progress")
	}
}

func TestSetPermissionModeAcceptsOnlyOfferedModes(t *testing.T) {
	m, _, _ := newTestManager(t)
	m.providers["fake"] = effortProvider{got: make(chan provider.Spec, 1)}
	proj, _ := m.CreateProject("Perm", t.TempDir())
	a, _ := m.Launch(LaunchRequest{ProjectID: proj.ID, Provider: "fake", Model: "m-plain"})
	sum, err := m.SetPermissionMode(a.ID, "m")
	if err != nil || sum.PermissionMode != "m" {
		t.Fatalf("offered mode: sum=%q err=%v", sum.PermissionMode, err)
	}
	if _, err := m.SetPermissionMode(a.ID, "nope"); err == nil {
		t.Fatal("a mode the provider does not offer should be refused")
	}
}
