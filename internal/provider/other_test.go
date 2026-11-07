package provider

import "testing"

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
