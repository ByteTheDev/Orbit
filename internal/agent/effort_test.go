package agent

import (
	"context"
	"testing"

	"orbit/internal/model"
	"orbit/internal/provider"
)

// effortProvider offers one model with thinking levels and one without, and reports each turn's spec.
type effortProvider struct {
	fakeProvider
	got chan provider.Spec
}

func (p effortProvider) Capabilities() model.Capabilities {
	c := p.fakeProvider.Capabilities()
	c.Models = []model.ModelOption{
		{ID: "m-think", Label: "Think", Effort: []string{"low", "high"}, DefaultEffort: "low"},
		{ID: "m-plain", Label: "Plain"},
	}
	return c
}

func (p effortProvider) Run(ctx context.Context, spec provider.Spec, emit func(provider.Update)) error {
	p.got <- spec
	emit(provider.Update{Kind: provider.UpdTurnDone, Success: true})
	return nil
}

func TestLaunchRejectsAnEffortTheModelDoesNotOffer(t *testing.T) {
	m, _, _ := newTestManager(t)
	m.providers["fake"] = effortProvider{got: make(chan provider.Spec, 1)}
	proj, _ := m.CreateProject("Effort", t.TempDir())
	if _, err := m.Launch(LaunchRequest{ProjectID: proj.ID, Provider: "fake", Model: "m-think", Effort: "max"}); err == nil {
		t.Fatal("an effort level outside the model's list should be refused")
	}
	if _, err := m.Launch(LaunchRequest{ProjectID: proj.ID, Provider: "fake", Model: "m-plain", Effort: "low"}); err == nil {
		t.Fatal("effort on a model without effort levels should be refused")
	}
}

func TestEffortReachesTheTurnAndTheSummary(t *testing.T) {
	m, _, _ := newTestManager(t)
	got := make(chan provider.Spec, 1)
	m.providers["fake"] = effortProvider{got: got}
	proj, _ := m.CreateProject("Effort", t.TempDir())
	a, err := m.Launch(LaunchRequest{ProjectID: proj.ID, Provider: "fake", Model: "m-think", Effort: "high", Task: "go"})
	if err != nil {
		t.Fatalf("launch: %v", err)
	}
	if a.Effort != "high" {
		t.Fatalf("summary effort = %q, want high", a.Effort)
	}
	if spec := <-got; spec.Effort != "high" {
		t.Fatalf("turn effort = %q, want high", spec.Effort)
	}
	waitIdle(t, m, a.ID)
}

func TestEmptyEffortMeansTheCLIDefault(t *testing.T) {
	m, _, _ := newTestManager(t)
	got := make(chan provider.Spec, 1)
	m.providers["fake"] = effortProvider{got: got}
	proj, _ := m.CreateProject("Effort", t.TempDir())
	a, err := m.Launch(LaunchRequest{ProjectID: proj.ID, Provider: "fake", Model: "m-think", Task: "go"})
	if err != nil {
		t.Fatalf("launch: %v", err)
	}
	if spec := <-got; spec.Effort != "" {
		t.Fatalf("no effort chosen should send none, got %q", spec.Effort)
	}
	waitIdle(t, m, a.ID)
}
