package provider

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

// A broken shim earlier on PATH must not shadow a working install behind it.
func TestLookPathSkipsBrokenCandidate(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("shim fixture is written for Windows")
	}
	bad := t.TempDir()
	good := t.TempDir()
	badExe := filepath.Join(bad, "fakecli.cmd")
	goodExe := filepath.Join(good, "fakecli.cmd")
	if err := os.WriteFile(badExe, []byte("@echo could not create process\r\n@exit /b 255\r\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(goodExe, []byte("@echo 1.0.0\r\n@exit /b 0\r\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", bad+string(os.PathListSeparator)+good)

	got, ok := lookPath("fakecli")
	if !ok {
		t.Fatal("expected a working candidate")
	}
	if !strings.EqualFold(got, goodExe) {
		t.Fatalf("got %q, want %q", got, goodExe)
	}
}

func TestLookPathMissing(t *testing.T) {
	t.Setenv("PATH", t.TempDir())
	if _, ok := lookPath("definitely-not-a-real-cli"); ok {
		t.Fatal("expected not found")
	}
}
