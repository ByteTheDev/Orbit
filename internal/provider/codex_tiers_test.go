package provider

import (
	"slices"
	"testing"
)

const tierCacheWithUltra = `{"models":[
  {"slug":"gpt-6-astra","service_tiers":[{"id":"priority","name":"Fast"},{"id":"ultra-fast","name":"Ultrafast"}]},
  {"slug":"gpt-6-luna","service_tiers":[{"id":"priority","name":"Fast"}]}
]}`

func TestParseCodexUltraTiersFindsTheAccountsUltrafastTier(t *testing.T) {
	got := parseCodexUltraTiers([]byte(tierCacheWithUltra))
	if got["gpt-6-astra"] != "ultra-fast" {
		t.Fatalf("astra ultrafast tier = %q, want ultra-fast", got["gpt-6-astra"])
	}
	if _, ok := got["gpt-6-luna"]; ok {
		t.Fatal("luna has no ultrafast tier but was marked as having one")
	}
}

func TestParseCodexUltraTiersIsEmptyWithoutTheTier(t *testing.T) {
	plus := `{"models":[{"slug":"gpt-6-astra","service_tiers":[{"id":"priority","name":"Fast"}]}]}`
	if got := parseCodexUltraTiers([]byte(plus)); len(got) != 0 {
		t.Fatalf("expected no ultrafast tiers, got %v", got)
	}
}

func TestParseCodexUltraTiersTreatsBadJSONAsNoTiers(t *testing.T) {
	if got := parseCodexUltraTiers([]byte("not json")); got == nil || len(got) != 0 {
		t.Fatalf("expected an empty map, got %v", got)
	}
}

func TestCodexModelsForAccountMarksOnlyTheModelsTheAccountCanRun(t *testing.T) {
	prev := ultraTierLookup
	t.Cleanup(func() { ultraTierLookup = prev })
	ultraTierLookup = func(model string) string {
		if model == "gpt-6-astra" {
			return "ultra-fast"
		}
		return ""
	}
	marked := map[string]bool{}
	for _, m := range codexModelsForAccount() {
		marked[m.ID] = m.UltraFast
	}
	if !marked["gpt-6-astra"] {
		t.Fatal("astra should be marked ultrafast")
	}
	if marked["gpt-6-luna"] {
		t.Fatal("luna should not be marked ultrafast")
	}
}

func TestCodexArgsSendTheAccountsUltrafastTierWhenAskedFor(t *testing.T) {
	prev := ultraTierLookup
	t.Cleanup(func() { ultraTierLookup = prev })
	ultraTierLookup = func(string) string { return "ultra-fast" }

	args := codexArgs(Spec{Model: "gpt-6-astra", FastMode: true, UltraFast: true})
	want := `service_tier="ultra-fast"`
	if i := slices.Index(args, want); i < 1 || args[i-1] != "-c" {
		t.Fatalf("expected -c %s, got %v", want, args)
	}
	if slices.Contains(args, `service_tier="fast"`) {
		t.Fatalf("ultrafast turn also sent the plain fast tier: %v", args)
	}
}
