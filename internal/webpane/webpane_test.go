package webpane

import "testing"

func TestParseMessageAcceptsTitleAndLoading(t *testing.T) {
	m, ok := parseMessage(`{"t":"title","title":"Roblox","url":"https://www.roblox.com/"}`)
	if !ok || m.T != "title" || m.Title != "Roblox" || m.URL != "https://www.roblox.com/" {
		t.Fatalf("title message: got %+v ok=%v", m, ok)
	}
	if m, ok := parseMessage(`{"t":"loading","url":"https://example.com/"}`); !ok || m.T != "loading" {
		t.Fatalf("loading message: got %+v ok=%v", m, ok)
	}
}

func TestParseMessageIgnoresOtherPayloads(t *testing.T) {
	for _, raw := range []string{`not json`, `{"t":"other"}`, `{}`} {
		if _, ok := parseMessage(raw); ok {
			t.Errorf("%q should be ignored", raw)
		}
	}
}
