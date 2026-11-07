package agent

import (
	"context"
	"testing"

	"orbit/internal/model"
	"orbit/internal/provider"
)

// specProvider offers two models, one of which runs in fast mode, and reports the spec of each turn.
type specProvider struct {
	fakeProvider
	got chan provider.Spec
}

func (p specProvider) Capabilities() model.Capabilities {
	c := p.fakeProvider.Capabilities()
	c.Models = []model.ModelOption{{ID: "m-fast", Label: "Fast", FastMode: true}, {ID: "m-plain", Label: "Plain"}}
	return c
}

func (p specProvider) Run(ctx context.Context, spec provider.Spec, emit func(provider.Update)) error {
	p.got <- spec
	emit(provider.Update{Kind: provider.UpdTurnDone, Success: true})
	return nil
}

func TestLaunchRejectsFastModeOnAModelWithoutIt(t *testing.T) {
	m, _, _ := newTestManager(t)
	m.providers["fake"] = specProvider{got: make(chan provider.Spec, 1)}
	proj, _ := m.CreateProject("Fast", t.TempDir())
	_, err := m.Launch(LaunchRequest{ProjectID: proj.ID, Provider: "fake", Model: "m-plain", FastMode: true})
	if err == nil {
		t.Fatal("fast mode on a model without it should be refused")
	}
}

func TestLaunchRejectsFastModeWithNoModel(t *testing.T) {
	m, _, _ := newTestManager(t)
	m.providers["fake"] = specProvider{got: make(chan provider.Spec, 1)}
	proj, _ := m.CreateProject("Fast", t.TempDir())
	if _, err := m.Launch(LaunchRequest{ProjectID: proj.ID, Provider: "fake", FastMode: true}); err == nil {
		t.Fatal("fast mode without a chosen model cannot be guaranteed and should be refused")
	}
}

func TestFastModeReachesTheTurnAndTheSummary(t *testing.T) {
	m, _, _ := newTestManager(t)
	got := make(chan provider.Spec, 1)
	m.providers["fake"] = specProvider{got: got}
	proj, _ := m.CreateProject("Fast", t.TempDir())
	a, err := m.Launch(LaunchRequest{ProjectID: proj.ID, Provider: "fake", Model: "m-fast", FastMode: true, Task: "go"})
	if err != nil {
		t.Fatalf("launch: %v", err)
	}
	if !a.FastMode {
		t.Fatal("summary should report fast mode")
	}
	if spec := <-got; !spec.FastMode {
		t.Fatal("the turn spec should carry fast mode")
	}
	waitIdle(t, m, a.ID)
}
