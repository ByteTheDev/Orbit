package provider

import (
	"slices"
	"strings"
	"testing"

	"orbit/internal/model"
)

func TestClaudeArgsPassEffortOnlyWhenChosen(t *testing.T) {
	args := claudeArgs(Spec{Prompt: "x", Effort: "xhigh"})
	i := slices.Index(args, "--effort")
	if i < 0 || i+1 >= len(args) || args[i+1] != "xhigh" {
		t.Fatalf("want --effort xhigh, got %v", args)
	}
	if slices.Contains(claudeArgs(Spec{Prompt: "x"}), "--effort") {
		t.Fatal("no effort chosen should not send --effort")
	}
}

func TestCodexArgsSetReasoningEffortAsTOML(t *testing.T) {
	args := codexArgs(Spec{Prompt: "x", Effort: "high"})
	if !slices.Contains(args, `model_reasoning_effort="high"`) {
		t.Fatalf("want model_reasoning_effort override, got %v", args)
	}
	if args[len(args)-1] != "-" {
		t.Fatalf("prompt marker must stay last: %v", args)
	}
	if strings.Contains(strings.Join(codexArgs(Spec{Prompt: "x"}), " "), "model_reasoning_effort") {
		t.Fatal("no effort chosen should not override the reasoning effort")
	}
}

func TestModelEffortDefaultsAreOfferedLevels(t *testing.T) {
	for _, list := range [][]model.ModelOption{claudeModels, codexModels} {
		for _, m := range list {
			if m.DefaultEffort != "" && !slices.Contains(m.Effort, m.DefaultEffort) {
				t.Errorf("%s: default effort %q is not one of %v", m.ID, m.DefaultEffort, m.Effort)
			}
		}
	}
}
