package terminal

import (
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestSplitUTF8HoldsBackPartialCharacters(t *testing.T) {
	// "é" is 0xC3 0xA9. Split it across two reads.
	first, rest := splitUTF8([]byte("ab\xC3"))
	if first != "ab" || len(rest) != 1 || rest[0] != 0xC3 {
		t.Fatalf("first read: got %q, rest %x", first, rest)
	}
	text, rest := splitUTF8(append(rest, 0xA9))
	if text != "é" || rest != nil {
		t.Fatalf("second read: got %q, rest %x", text, rest)
	}
}

func TestSplitUTF8PassesCompleteText(t *testing.T) {
	text, rest := splitUTF8([]byte("plain ✓ text"))
	if text != "plain ✓ text" || rest != nil {
		t.Fatalf("got %q, rest %x", text, rest)
	}
}

func TestClampSize(t *testing.T) {
	cases := map[int]int{-5: 1, 0: 1, 80: 80, 5000: maxCells}
	for in, want := range cases {
		if got := clampSize(in); got != want {
			t.Errorf("clampSize(%d) = %d, want %d", in, got, want)
		}
	}
}

func TestOpenRejectsMissingFolder(t *testing.T) {
	m := New(func(string, string) {}, func(string) {})
	if err := m.Open("t1", "C:/definitely/not/here", 80, 24); err == nil {
		t.Fatal("expected an error for a missing folder")
	}
}

func TestUnknownTerminalIsNotFound(t *testing.T) {
	m := New(func(string, string) {}, func(string) {})
	if err := m.Write("nope", "x"); err != ErrNotFound {
		t.Fatalf("Write: got %v, want ErrNotFound", err)
	}
	if err := m.Close("nope"); err != ErrNotFound {
		t.Fatalf("Close: got %v, want ErrNotFound", err)
	}
}

// TestShellRoundTrip starts a real shell, types a command, and checks the output comes back.
// It uses the platform shell and is skipped in -short runs.
func TestShellRoundTrip(t *testing.T) {
	if testing.Short() {
		t.Skip("starts a real shell")
	}
	var mu sync.Mutex
	var out strings.Builder
	exited := make(chan struct{})
	m := New(func(_, data string) {
		mu.Lock()
		out.WriteString(data)
		mu.Unlock()
	}, func(string) { close(exited) })

	dir := t.TempDir()
	if err := m.Open("rt", dir, 100, 30); err != nil {
		t.Fatal(err)
	}
	defer m.CloseAll()

	command := "printf 'orbit-terminal-ok\\n'\n"
	if runtime.GOOS == "windows" {
		command = "Write-Output 'orbit-terminal-ok'\r\n"
	}
	if err := m.Write("rt", command); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(20 * time.Second)
	for time.Now().Before(deadline) {
		mu.Lock()
		got := out.String()
		mu.Unlock()
		if strings.Contains(got, "orbit-terminal-ok") {
			return
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatalf("command output never arrived; got %q", out.String())
}
