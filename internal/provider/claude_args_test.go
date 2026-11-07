package provider

import (
	"slices"
	"testing"
)

func TestClaudeArgsAddFastModeOnlyWhenAsked(t *testing.T) {
	on := claudeArgs(Spec{Model: "claude-opus-5-5", FastMode: true})
	if i := slices.Index(on, "--fast-mode"); i < 0 || on[i+1] != "on" {
		t.Fatalf("expected --fast-mode on, got %v", on)
	}
	off := claudeArgs(Spec{Model: "claude-opus-5-5"})
	if slices.Contains(off, "--fast-mode") {
		t.Fatalf("fast mode should not be sent when off, got %v", off)
	}
}
