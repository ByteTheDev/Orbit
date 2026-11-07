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

func TestOpenCodeCatalogCarriesThinkingVariants(t *testing.T) {
	raw := []byte(`{"data":[
		{"providerID":"opencode-go","modelID":"beam-free","variants":[{"id":"low"},{"id":"high"}]},
		{"providerID":"opencode-go","modelID":"plain","variants":[]},
		{"providerID":"opencode-go","modelID":"plain"}
	]}`)
	list, ok := parseOpenCodeCatalog(raw)
	if !ok || len(list) != 2 {
		t.Fatalf("got %v ok=%v", list, ok)
	}
	if list[0].ID != "opencode-go/beam-free" || list[0].Group != "opencode-go" {
		t.Fatalf("first model %+v", list[0])
	}
	if got := list[0].Effort; len(got) != 2 || got[0] != "low" || got[1] != "high" {
		t.Fatalf("effort %v", got)
	}
	if list[1].Effort == nil || len(list[1].Effort) != 0 {
		t.Fatalf("a model without variants should offer no levels, got %v", list[1].Effort)
	}
	if _, ok := parseOpenCodeCatalog([]byte(`{"data":[]}`)); ok {
		t.Fatal("an empty catalog should not count as a result")
	}
}

func TestOpenCodeThinkingGoesInTheModelID(t *testing.T) {
	args := openCodeArgs(Spec{Prompt: "x", Model: "opencode-go/beam-free", Effort: "high"})
	i := slices.Index(args, "--model")
	if i < 0 || args[i+1] != "opencode-go/beam-free#high" {
		t.Fatalf("args %v", args)
	}
	if slices.Contains(args, "--variant") {
		t.Fatal("opencode run has no --variant flag")
	}
	plain := openCodeArgs(Spec{Prompt: "x", Model: "opencode-go/beam-free"})
	if slices.Contains(plain, "--variant") || plain[slices.Index(plain, "--model")+1] != "opencode-go/beam-free" {
		t.Fatalf("no effort should leave the model id alone, got %v", plain)
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
