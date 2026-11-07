package browser

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

const samplePage = `<!doctype html>
<html><head><meta charset="utf-8"><title>  Orbit   Docs </title>
<style>body { color: red }</style><script>var secret = "hidden";</script></head>
<body>
<nav><a href="/install">Install   guide</a> <a href="/install">Install again</a>
<a href="javascript:alert(1)">bad</a> <a href="#top">top</a> <a href="mailto:x@y.z">mail</a></nav>
<h1>Welcome</h1><p>First <b>bold</b> paragraph.</p><p>Second&nbsp;paragraph &amp; more.</p>
<ul><li>one</li><li>two</li></ul>
</body></html>`

func newServer(t *testing.T, h http.HandlerFunc) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(h)
	t.Cleanup(srv.Close)
	return srv
}

func TestFetchExtractsTitleTextAndLinks(t *testing.T) {
	srv := newServer(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/docs" {
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			_, _ = w.Write([]byte(samplePage))
			return
		}
		http.NotFound(w, r)
	})

	page, err := Fetch(context.Background(), srv.URL+"/docs")
	if err != nil {
		t.Fatalf("Fetch: %v", err)
	}
	if page.Status != 200 || page.ContentType != "text/html" {
		t.Fatalf("status/type = %d %q", page.Status, page.ContentType)
	}
	if page.Title != "Orbit Docs" {
		t.Errorf("title = %q", page.Title)
	}
	for _, bad := range []string{"secret", "color: red", "alert"} {
		if strings.Contains(page.Text, bad) {
			t.Errorf("text leaked %q: %q", bad, page.Text)
		}
	}
	for _, want := range []string{"Welcome", "First bold paragraph.", "Second paragraph & more.", "one\ntwo"} {
		if !strings.Contains(page.Text, want) {
			t.Errorf("text missing %q: %q", want, page.Text)
		}
	}
	if len(page.Links) != 1 {
		t.Fatalf("links = %+v, want one (javascript, mailto, fragment and duplicates dropped)", page.Links)
	}
	if page.Links[0].Text != "Install guide" || page.Links[0].URL != srv.URL+"/install" {
		t.Errorf("link = %+v", page.Links[0])
	}
}

func TestFetchEmptyLinksSerialiseAsArray(t *testing.T) {
	srv := newServer(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		_, _ = w.Write([]byte("<p>no links here</p>"))
	})
	page, err := Fetch(context.Background(), srv.URL)
	if err != nil {
		t.Fatal(err)
	}
	b, _ := json.Marshal(page)
	if !strings.Contains(string(b), `"links":[]`) {
		t.Errorf("links should be [] not null: %s", b)
	}
}

func TestFetchNotFoundReturnsPageWithStatus(t *testing.T) {
	srv := newServer(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		w.WriteHeader(http.StatusNotFound)
		_, _ = w.Write([]byte("<title>Missing</title><p>gone</p>"))
	})
	page, err := Fetch(context.Background(), srv.URL+"/nope")
	if err != nil {
		t.Fatalf("404 should not be an error: %v", err)
	}
	if page.Status != 404 || page.Title != "Missing" {
		t.Errorf("page = %+v", page)
	}
}

func TestFetchFollowsRedirectsAndReportsFinalURL(t *testing.T) {
	srv := newServer(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/old" {
			http.Redirect(w, r, "/new", http.StatusMovedPermanently)
			return
		}
		w.Header().Set("Content-Type", "text/plain")
		_, _ = w.Write([]byte("arrived"))
	})
	page, err := Fetch(context.Background(), srv.URL+"/old")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasSuffix(page.URL, "/new") || page.Text != "arrived" {
		t.Errorf("page = %+v", page)
	}
}

func TestFetchRejectsBinaryAndKeepsPlainText(t *testing.T) {
	srv := newServer(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/img" {
			w.Header().Set("Content-Type", "image/png")
			_, _ = w.Write([]byte("\x89PNG\r\n\x1a\n...."))
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true}`))
	})
	if _, err := Fetch(context.Background(), srv.URL+"/img"); err == nil || !strings.Contains(err.Error(), "image/png") {
		t.Errorf("binary page error = %v", err)
	}
	page, err := Fetch(context.Background(), srv.URL+"/data")
	if err != nil || page.Text != `{"ok":true}` {
		t.Errorf("json page = %+v, %v", page, err)
	}
}

func TestFetchTruncatesLongBodies(t *testing.T) {
	long := strings.Repeat("word ", maxTextRunes) // well past the text cap
	srv := newServer(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain")
		_, _ = w.Write([]byte(long))
	})
	page, err := Fetch(context.Background(), srv.URL)
	if err != nil {
		t.Fatal(err)
	}
	if !page.Truncated || len([]rune(page.Text)) != maxTextRunes {
		t.Errorf("truncated=%v runes=%d", page.Truncated, len([]rune(page.Text)))
	}
}

func TestParseURL(t *testing.T) {
	ok := map[string]string{
		"example.com":            "https://example.com",
		"  http://a.test/x  ":    "http://a.test/x",
		"https://b.test/p?q=1#f": "https://b.test/p?q=1#f",
	}
	for in, want := range ok {
		u, err := ParseURL(in)
		if err != nil || u.String() != want {
			t.Errorf("ParseURL(%q) = %v, %v; want %s", in, u, err, want)
		}
	}
	for _, in := range []string{"", "   ", "file:///etc/passwd", "javascript:alert(1)", "https://"} {
		if _, err := ParseURL(in); err == nil {
			t.Errorf("ParseURL(%q) should fail", in)
		}
	}
}

func TestCutRunesKeepsCharactersWhole(t *testing.T) {
	s, cut := cutRunes("héllo wörld", 5)
	if !cut || s != "héllo" {
		t.Errorf("cutRunes = %q, %v", s, cut)
	}
}

func TestServeMCPListsAndCallsTool(t *testing.T) {
	srv := newServer(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		_, _ = w.Write([]byte("<title>Status</title><p>All systems go.</p>"))
	})
	input := strings.Join([]string{
		`{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}`,
		`{"jsonrpc":"2.0","method":"notifications/initialized"}`,
		`{"jsonrpc":"2.0","id":2,"method":"tools/list"}`,
		`{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"browse_page","arguments":{"url":"` + srv.URL + `"}}}`,
		`{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"other","arguments":{}}}`,
		`{"jsonrpc":"2.0","id":5,"method":"resources/list"}`,
	}, "\n")

	var out bytes.Buffer
	if err := ServeMCP(strings.NewReader(input), &out); err != nil {
		t.Fatal(err)
	}
	lines := strings.Split(strings.TrimSpace(out.String()), "\n")
	// The notification gets no reply, so five responses for six messages.
	if len(lines) != 5 {
		t.Fatalf("got %d replies, want 5:\n%s", len(lines), out.String())
	}
	if !strings.Contains(lines[0], `"orbit-browser"`) {
		t.Errorf("initialize reply = %s", lines[0])
	}
	if !strings.Contains(lines[1], `"browse_page"`) {
		t.Errorf("tools/list reply = %s", lines[1])
	}
	if !strings.Contains(lines[2], "All systems go.") || !strings.Contains(lines[2], `"isError":false`) {
		t.Errorf("tools/call reply = %s", lines[2])
	}
	if !strings.Contains(lines[3], `"isError":true`) {
		t.Errorf("unknown tool should be an error result: %s", lines[3])
	}
	if !strings.Contains(lines[4], `"code":-32601`) {
		t.Errorf("unknown method reply = %s", lines[4])
	}
}
