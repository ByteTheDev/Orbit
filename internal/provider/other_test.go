package provider

import (
	"slices"
	"testing"
)

func TestOMPArgsPassApprovalModeAndThinking(t *testing.T) {
	args := ompArgs(Spec{Prompt: "x", Model: "openai/gpt-5", PermissionMode: "yolo", Effort: "high"})
	for _, want := range [][]string{{"--approval-mode", "yolo"}, {"--thinking", "high"}, {"--model", "openai/gpt-5"}} {
		i := slices.Index(args, want[0])
		if i < 0 || i+1 >= len(args) || args[i+1] != want[1] {
			t.Fatalf("args %v: want %v", args, want)
		}
	}
}

func TestOMPArgsOmitUnchosenOptions(t *testing.T) {
	args := ompArgs(Spec{Prompt: "x"})
	if slices.Contains(args, "--approval-mode") || slices.Contains(args, "--thinking") {
		t.Fatalf("no choice should send no flag, got %v", args)
	}
}

func TestOpenCodeArgsAutoOnlyForFullAccess(t *testing.T) {
	if !slices.Contains(openCodeArgs(Spec{Prompt: "x", PermissionMode: "auto"}), "--auto") {
		t.Fatal("full access should pass --auto")
	}
	for _, mode := range []string{"", "ask"} {
		if slices.Contains(openCodeArgs(Spec{Prompt: "x", PermissionMode: mode}), "--auto") {
			t.Fatalf("mode %q should not pass --auto", mode)
		}
	}
}

func TestOtherProvidersOfferPermissionModes(t *testing.T) {
	if len(OMP{}.Capabilities().PermissionModes) == 0 || len(OpenCode{}.Capabilities().PermissionModes) == 0 {
		t.Fatal("OMP and OpenCode must offer permission modes")
	}
}

func TestOtherProvidersParseSessionsAndMessages(t *testing.T) {
	omp := &ompParser{}
	if got := omp.parse([]byte(`{"type":"session","id":"session-1"}`)); len(got) != 1 || got[0].ID != "session-1" {
		t.Fatal(got)
	}
	if got := omp.parse([]byte(`{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"hello"}]}}`)); len(got) != 2 || got[0].Text != "hello" {
		t.Fatal(got)
	}
	oc := &openCodeParser{}
	got := oc.parse([]byte(`{"type":"text","sessionID":"ses-1","part":{"id":"part-1","text":"hello"}}`))
	if len(got) != 2 || got[0].ID != "ses-1" || got[1].Text != "hello" {
		t.Fatal(got)
	}
}
