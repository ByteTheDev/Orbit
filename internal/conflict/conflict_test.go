package conflict

import "testing"

func TestDetectFindsSharedWrites(t *testing.T) {
	agents := []AgentWrites{
		{ID: "a", Name: "Alpha", Writes: map[string]int{"src/App.tsx": 2, "README.md": 1}},
		{ID: "b", Name: "Beta", Writes: map[string]int{"src/App.tsx": 1}},
		{ID: "c", Name: "Gamma", Writes: map[string]int{"README.md": 0}},
	}
	got := Detect(agents)
	if len(got) != 1 {
		t.Fatalf("want 1 conflict, got %d: %+v", len(got), got)
	}
	if got[0].Path != "src/App.tsx" || len(got[0].Agents) != 2 {
		t.Fatalf("unexpected conflict: %+v", got[0])
	}
}

func TestDetectIgnoresReadsAndSingleWriters(t *testing.T) {
	agents := []AgentWrites{
		{ID: "a", Name: "Alpha", Writes: map[string]int{"x.go": 3}},
		{ID: "b", Name: "Beta", Writes: map[string]int{"y.go": 1}},
	}
	if got := Detect(agents); len(got) != 0 {
		t.Fatalf("want no conflicts, got %+v", got)
	}
}
