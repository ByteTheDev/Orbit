package provider

import "testing"

func TestModelListsMatchTheCatalogs(t *testing.T) {
	if got := len(Claude{}.Capabilities().Models); got != 12 {
		t.Fatalf("claude models = %d, want 12", got)
	}
	if got := len(Codex{}.Capabilities().Models); got != 8 {
		t.Fatalf("codex models = %d, want 8", got)
	}
	caps := Claude{}.Capabilities()
	if !caps.HasModel("claude-opus-5-5") {
		t.Fatal("current Opus missing from the Claude list")
	}
	if caps.HasModel("made-up-model") {
		t.Fatal("unknown model accepted")
	}
	if !(Codex{}).Capabilities().HasModel("gpt-6.1-sol") {
		t.Fatal("current Codex model missing")
	}
}
