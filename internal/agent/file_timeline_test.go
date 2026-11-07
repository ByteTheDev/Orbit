package agent

import (
	"testing"

	"orbit/internal/model"
)

// The timeline lists the operations of every agent in the same project, newest first, and leaves
// out agents in other projects.
func TestFileTimelineCollectsEveryAgentInTheProject(t *testing.T) {
	m, _, _ := newTestManager(t)
	file := func(ops ...model.FileOpRecord) map[string]*model.FileActivity {
		return map[string]*model.FileActivity{"src/a.go": {Path: "src/a.go", Ops: ops}}
	}
	m.agents["writer"] = &model.AgentRecord{ID: "writer", Name: "Writer", ProjectID: "p1", Files: file(
		model.FileOpRecord{Op: "read", Tool: "Read", At: 100},
		model.FileOpRecord{Op: "write", Tool: "Edit", At: 300},
	)}
	m.agents["reviewer"] = &model.AgentRecord{ID: "reviewer", Name: "Reviewer", ProjectID: "p1", Files: file(
		model.FileOpRecord{Op: "read", Tool: "Grep", At: 200},
	)}
	m.agents["elsewhere"] = &model.AgentRecord{ID: "elsewhere", Name: "Other", ProjectID: "p2", Files: file(
		model.FileOpRecord{Op: "write", Tool: "Write", At: 400},
	)}

	events, err := m.FileTimeline("writer", "src/a.go")
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 3 {
		t.Fatalf("want 3 events from the project, got %d: %+v", len(events), events)
	}
	order := []int64{300, 200, 100}
	for i, e := range events {
		if e.At != order[i] {
			t.Errorf("event %d at %d, want %d", i, e.At, order[i])
		}
	}
	if events[1].AgentName != "Reviewer" || events[1].Tool != "Grep" {
		t.Errorf("reviewer event wrong: %+v", events[1])
	}
}

func TestFileTimelineForUnknownAgentIsNotFound(t *testing.T) {
	m, _, _ := newTestManager(t)
	if _, err := m.FileTimeline("nobody", "a.go"); err != ErrNotFound {
		t.Fatalf("want ErrNotFound, got %v", err)
	}
}

func TestFileTimelineIsEmptyNotNil(t *testing.T) {
	m, _, _ := newTestManager(t)
	m.agents["solo"] = &model.AgentRecord{ID: "solo", ProjectID: "p1", Files: map[string]*model.FileActivity{}}
	events, err := m.FileTimeline("solo", "untouched.go")
	if err != nil || events == nil || len(events) != 0 {
		t.Fatalf("want an empty, non-nil list, got %v, %v", events, err)
	}
}
