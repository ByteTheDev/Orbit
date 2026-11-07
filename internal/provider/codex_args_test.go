package provider

import (
	"slices"
	"testing"
)

const codexFastOverride = `service_tier="fast"`

func TestCodexArgsAddFastModeOnlyWhenAsked(t *testing.T) {
	on := codexArgs(Spec{Model: "gpt-6.1-sol", FastMode: true})
	if i := slices.Index(on, "-c"); i < 0 || on[i+1] != codexFastOverride {
		t.Fatalf("expected -c %s on a fast turn, got %v", codexFastOverride, on)
	}
	off := codexArgs(Spec{Model: "gpt-6.1-sol"})
	if slices.Contains(off, "-c") {
		t.Fatalf("fast mode should not be sent when off, got %v", off)
	}
}

func TestCodexResumeArgsCarryFastModeBeforeTheSessionID(t *testing.T) {
	args := codexArgs(Spec{Model: "gpt-6.1-sol", FastMode: true, Resume: true, SessionID: "thread-1"})
	if args[1] != "resume" {
		t.Fatalf("expected a resume command, got %v", args)
	}
	i := slices.Index(args, "-c")
	if i < 0 || args[i+1] != codexFastOverride {
		t.Fatalf("expected -c %s on a resumed fast turn, got %v", codexFastOverride, args)
	}
	if i > slices.Index(args, "thread-1") {
		t.Fatalf("the override must come before the session id, got %v", args)
	}
}
