package browser

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"sync/atomic"
	"testing"
)

const outlinePage = `<!doctype html><html><head><title>Guide</title>
<meta name="description" content="  How   to   install  Orbit. ">
</head><body>
<h1>Install</h1><p>Start here.</p>
<h2>On   Windows</h2><p>Run the installer.</p>
<h3></h3><h4>Notes</h4><h5>Too deep</h5>
</body></html>`

func TestFetchDocumentReadsOutlineAndDescription(t *testing.T) {
	srv := newServer(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = w.Write([]byte(outlinePage))
	})
	doc, err := FetchDocument(context.Background(), srv.URL)
	if err != nil {
		t.Fatal(err)
	}
	if doc.Description != "How to install Orbit." {
		t.Errorf("description = %q", doc.Description)
	}
	want := []Heading{{1, "Install"}, {2, "On Windows"}, {4, "Notes"}}
	if len(doc.Headings) != len(want) {
		t.Fatalf("headings = %+v, want %+v (empty and h5 dropped)", doc.Headings, want)
	}
	for i := range want {
		if doc.Headings[i] != want[i] {
			t.Errorf("heading %d = %+v, want %+v", i, doc.Headings[i], want[i])
		}
	}
}

func TestFetchStillReturnsAPlainPage(t *testing.T) {
	srv := newServer(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		_, _ = w.Write([]byte(outlinePage))
	})
	page, err := Fetch(context.Background(), srv.URL)
	if err != nil || page.Title != "Guide" {
		t.Fatalf("Fetch = %+v, %v", page, err)
	}
}

// longDoc is 50 characters of text, with a title and an outline.
func longDoc() Document {
	return Document{
		Page:     Page{URL: "https://x.test/", Status: 200, ContentType: "text/plain", Title: "T", Text: strings.Repeat("abcdefghij", 5), Links: []Link{}},
		Headings: []Heading{{Level: 1, Text: "Top"}},
	}
}

func TestFormatReadsTheTextInWindows(t *testing.T) {
	doc := longDoc()

	first := FormatForAgent(doc, Request{MaxChars: 10})
	for _, want := range []string{"--- outline ---\n- Top", "Characters 0–10 of 50. Call again with offset=10 to read on.", "abcdefghij\n"} {
		if !strings.Contains(first, want) {
			t.Errorf("first window missing %q:\n%s", want, first)
		}
	}

	last := FormatForAgent(doc, Request{Offset: 40, MaxChars: 10})
	if !strings.Contains(last, "Characters 40–50 of 50.") || strings.Contains(last, "Call again") {
		t.Errorf("last window should say it is the end:\n%s", last)
	}
	if strings.Contains(last, "--- outline ---") {
		t.Errorf("outline should come with the first window only:\n%s", last)
	}

	past := FormatForAgent(doc, Request{Offset: 50, MaxChars: 10})
	if !strings.Contains(past, "offset 50 is past the end") {
		t.Errorf("offset past the end = %q", past)
	}
}

func TestFormatSaysWhenThePageWasCut(t *testing.T) {
	doc := longDoc()
	doc.Truncated = true
	out := FormatForAgent(doc, Request{Offset: 40, MaxChars: 10})
	if !strings.Contains(out, "of at least 50") || !strings.Contains(out, "stops reading here") {
		t.Errorf("cut page = %q", out)
	}
}

func TestFindReturnsOnlyMatchingPassages(t *testing.T) {
	doc := longDoc()
	doc.Text = "Alpha is first.\nNothing here.\nAnother alpha line.\nZeta."
	out := FormatForAgent(doc, Request{Find: "ALPHA", MaxChars: 20000})
	if !strings.Contains(out, `passages containing "ALPHA" (2 found)`) {
		t.Errorf("find header = %q", out)
	}
	if !strings.Contains(out, "- Alpha is first.") || !strings.Contains(out, "- Another alpha line.") {
		t.Errorf("matches missing:\n%s", out)
	}
	if strings.Contains(out, "Nothing here") || strings.Contains(out, "--- page text") {
		t.Errorf("find should not return the whole text:\n%s", out)
	}

	none := FormatForAgent(doc, Request{Find: "missing"})
	if !strings.Contains(none, "No passage on this page contains that text.") {
		t.Errorf("no-match reply = %q", none)
	}
}

func TestCacheFetchesAPageOnce(t *testing.T) {
	var hits atomic.Int32
	srv := newServer(t, func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		w.Header().Set("Content-Type", "text/plain")
		_, _ = w.Write([]byte("cached body"))
	})
	for i := 0; i < 3; i++ {
		doc, err := cachedDocument(context.Background(), srv.URL)
		if err != nil || doc.Text != "cached body" {
			t.Fatalf("call %d: %+v, %v", i, doc, err)
		}
	}
	if n := hits.Load(); n != 1 {
		t.Errorf("server was hit %d times, want 1", n)
	}
}

func TestCacheDoesNotKeepFailures(t *testing.T) {
	var hits atomic.Int32
	srv := newServer(t, func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		w.Header().Set("Content-Type", "application/pdf") // binary: an error, so nothing is cached
		_, _ = w.Write([]byte("%PDF-1.4"))
	})
	for i := 0; i < 2; i++ {
		if _, err := cachedDocument(context.Background(), srv.URL); err == nil {
			t.Fatal("binary page should be an error")
		}
	}
	if n := hits.Load(); n != 2 {
		t.Errorf("server was hit %d times, want 2 (failures are not cached)", n)
	}
}

func TestBrowseToolPagesFindsAndValidates(t *testing.T) {
	srv := newServer(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		_, _ = w.Write([]byte(outlinePage))
	})
	call := func(args map[string]any) string {
		args["url"] = srv.URL
		params, _ := json.Marshal(map[string]any{"name": ToolName, "arguments": args})
		reqLine, _ := json.Marshal(map[string]any{"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": json.RawMessage(params)})
		var out bytes.Buffer
		if err := ServeMCP(strings.NewReader(string(reqLine)+"\n"), &out); err != nil {
			t.Fatal(err)
		}
		return out.String()
	}

	if got := call(map[string]any{"find": "windows"}); !strings.Contains(got, `passages containing \"windows\" (1 found)`) {
		t.Errorf("find reply = %s", got)
	}
	if got := call(map[string]any{"offset": 5, "max_chars": 1000}); !strings.Contains(got, `"isError":false`) {
		t.Errorf("paged reply = %s", got)
	}
	if got := call(map[string]any{"offset": -1}); !strings.Contains(got, `offset cannot be negative`) || !strings.Contains(got, `"isError":true`) {
		t.Errorf("negative offset reply = %s", got)
	}
}

func TestToolSchemaOffersPagingAndFind(t *testing.T) {
	props := browseToolSchema()["inputSchema"].(map[string]any)["properties"].(map[string]any)
	for _, name := range []string{"url", "offset", "max_chars", "find"} {
		if _, ok := props[name]; !ok {
			t.Errorf("schema has no %q property", name)
		}
	}
}
