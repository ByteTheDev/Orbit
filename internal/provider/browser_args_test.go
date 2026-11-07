package provider

import (
	"encoding/json"
	"slices"
	"strings"
	"testing"
)

const testBrowserExe = `C:\Program Files\Orbit\orbit.exe`

func TestClaudeArgsRegisterBrowserWhenCommandSet(t *testing.T) {
	args := claudeArgs(Spec{BrowserCommand: testBrowserExe})
	i := slices.Index(args, "--mcp-config")
	if i < 0 || i+1 >= len(args) {
		t.Fatalf("no --mcp-config in %v", args)
	}
	var cfg struct {
		MCPServers map[string]struct {
			Command string   `json:"command"`
			Args    []string `json:"args"`
		} `json:"mcpServers"`
	}
	if err := json.Unmarshal([]byte(args[i+1]), &cfg); err != nil {
		t.Fatalf("config is not JSON: %v", err)
	}
	srv, ok := cfg.MCPServers["orbit-browser"]
	if !ok || srv.Command != testBrowserExe || !slices.Equal(srv.Args, []string{"--browser-mcp"}) {
		t.Errorf("server = %+v", srv)
	}
	j := slices.Index(args, "--allowedTools")
	if j < 0 || args[j+1] != "mcp__orbit-browser__browse_page" {
		t.Errorf("allowedTools missing or wrong in %v", args)
	}
}

func TestClaudeArgsOmitBrowserWhenCommandEmpty(t *testing.T) {
	args := claudeArgs(Spec{})
	if slices.Contains(args, "--mcp-config") || slices.Contains(args, "--allowedTools") {
		t.Errorf("browser flags present without a command: %v", args)
	}
}

func TestCodexArgsRegisterBrowserForNewAndResumedTurns(t *testing.T) {
	for _, spec := range []Spec{
		{BrowserCommand: testBrowserExe},
		{BrowserCommand: testBrowserExe, Resume: true, SessionID: "thread-1"},
	} {
		args := codexArgs(spec)
		want := []string{
			"-c", `mcp_servers.orbit-browser.command="C:\\Program Files\\Orbit\\orbit.exe"`,
		}
		if !containsRun(args, want) {
			t.Errorf("resume=%v: browser overrides missing from %v", spec.Resume, args)
		}
	}
}

func TestCodexArgsOmitBrowserWhenCommandEmpty(t *testing.T) {
	args := codexArgs(Spec{})
	for _, a := range args {
		if strings.Contains(a, "orbit-browser") {
			t.Errorf("browser override present without a command: %v", args)
		}
	}
}

func TestClaudeBrowseCallShowsAddress(t *testing.T) {
	in := map[string]any{"url": "https://example.com/docs"}
	if got := claudeSummary(browseToolName, in); got != "https://example.com/docs" {
		t.Errorf("summary = %q", got)
	}
	if _, detail := claudeStatus(browseToolName, in); detail != "Browsing https://example.com/docs" {
		t.Errorf("status detail = %q", detail)
	}
}

// containsRun reports whether seq appears as a contiguous run inside args.
func containsRun(args, seq []string) bool {
	for i := 0; i+len(seq) <= len(args); i++ {
		if slices.Equal(args[i:i+len(seq)], seq) {
			return true
		}
	}
	return false
}
