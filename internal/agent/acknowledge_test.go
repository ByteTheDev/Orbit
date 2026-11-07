package agent

import (
	"testing"

	"orbit/internal/model"
)

// Opening a finished agent clears its completed mark. Other states are not the user's to clear.
func TestAcknowledgeClearsCompletedOnly(t *testing.T) {
	m, _, _ := newTestManager(t)
	m.agents["done"] = &model.AgentRecord{ID: "done", Status: model.StatusCompleted, StatusDetail: "Turn complete", Files: map[string]*model.FileActivity{}}
	m.agents["broke"] = &model.AgentRecord{ID: "broke", Status: model.StatusFailed, StatusDetail: "Crashed", Files: map[string]*model.FileActivity{}}

	if err := m.Acknowledge("done"); err != nil {
		t.Fatal(err)
	}
	if got := m.agents["done"].Status; got != model.StatusIdle {
		t.Fatalf("completed agent status = %q, want idle", got)
	}
	if err := m.Acknowledge("broke"); err != nil {
		t.Fatal(err)
	}
	if got := m.agents["broke"].Status; got != model.StatusFailed {
		t.Fatalf("failed agent status = %q, want it unchanged", got)
	}
	if err := m.Acknowledge("missing"); err != ErrNotFound {
		t.Fatalf("unknown agent error = %v, want ErrNotFound", err)
	}
}
