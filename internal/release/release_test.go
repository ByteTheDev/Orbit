package release

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"regexp"
	"testing"
	"time"
)

func serve(t *testing.T, status int, body string) {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/repos/"+repo+"/releases/latest" {
			t.Errorf("unexpected path %s", r.URL.Path)
		}
		w.WriteHeader(status)
		_, _ = w.Write([]byte(body))
	}))
	t.Cleanup(srv.Close)
	old := apiBase
	apiBase = srv.URL
	t.Cleanup(func() { apiBase = old })
}

func TestLatestReadsTheNewestRelease(t *testing.T) {
	serve(t, http.StatusOK, `{"tag_name":"v1.0.2","body":"Notes","html_url":"https://github.com/ByteTheDev/Orbit/releases/tag/v1.0.2","published_at":"2026-11-07T03:36:56Z"}`)
	got, err := Latest(context.Background(), &http.Client{Timeout: 5 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	if got.Version != "1.0.2" || got.Notes != "Notes" || got.URL == "" || got.PublishedAt == 0 {
		t.Fatalf("unexpected release %+v", got)
	}
}

func TestLatestReportsNoReleaseYet(t *testing.T) {
	serve(t, http.StatusNotFound, `{"message":"Not Found"}`)
	if _, err := Latest(context.Background(), &http.Client{}); err != ErrNoRelease {
		t.Fatalf("err = %v, want ErrNoRelease", err)
	}
}

func TestLatestRejectsAServerError(t *testing.T) {
	serve(t, http.StatusForbidden, `{"message":"rate limited"}`)
	if _, err := Latest(context.Background(), &http.Client{}); err == nil {
		t.Fatal("expected an error for HTTP 403")
	}
}

// The frontend keeps its own copy of the version for the Release panel. This test keeps the two in step.
func TestFrontendVersionMatchesBackend(t *testing.T) {
	src, err := os.ReadFile("../../frontend/src/lib/release.ts")
	if err != nil {
		t.Fatal(err)
	}
	m := regexp.MustCompile(`APP_VERSION = '([^']+)'`).FindSubmatch(src)
	if m == nil {
		t.Fatal("APP_VERSION not found in release.ts")
	}
	if string(m[1]) != Version {
		t.Fatalf("frontend APP_VERSION %q != backend Version %q", m[1], Version)
	}
}
