package provider

import (
	"bufio"
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"
)

// procSpec is a command to run as a provider turn.
type procSpec struct {
	Bin   string
	Args  []string
	Dir   string
	Stdin string
}

// lineParser turns one stdout line into zero or more updates.
type lineParser func(line []byte) []Update

// tailBuffer keeps the last n bytes written to it, for diagnostics.
type tailBuffer struct {
	n   int
	buf bytes.Buffer
}

func (t *tailBuffer) Write(p []byte) (int, error) {
	t.buf.Write(p)
	if t.buf.Len() > 2*t.n {
		b := t.buf.Bytes()
		keep := append([]byte(nil), b[len(b)-t.n:]...)
		t.buf.Reset()
		t.buf.Write(keep)
	}
	return len(p), nil
}

func (t *tailBuffer) String() string {
	b := t.buf.Bytes()
	if len(b) > t.n {
		b = b[len(b)-t.n:]
	}
	return strings.TrimSpace(string(b))
}

// runProcess starts a provider CLI, feeds it the prompt on stdin, parses its
// stdout line by line and returns when the process exits. Cancelling ctx kills
// the process tree.
func runProcess(ctx context.Context, ps procSpec, parse lineParser, emit func(Update)) error {
	if _, err := os.Stat(ps.Dir); err != nil {
		return fmt.Errorf("repository folder is missing: %w", err)
	}
	cmd := exec.CommandContext(ctx, ps.Bin, ps.Args...)
	cmd.Dir = ps.Dir
	cmd.Stdin = strings.NewReader(ps.Stdin)
	cmd.WaitDelay = 5 * time.Second
	cmd.Cancel = func() error { return killTree(cmd.Process) }
	configureProcess(cmd)

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return fmt.Errorf("attach stdout: %w", err)
	}
	stderr := &tailBuffer{n: 4 << 10}
	cmd.Stderr = stderr

	if err := cmd.Start(); err != nil {
		return fmt.Errorf("start %s: %w", ps.Bin, err)
	}

	reader := bufio.NewReaderSize(stdout, 64<<10)
	for {
		line, readErr := reader.ReadBytes('\n')
		if len(bytes.TrimSpace(line)) > 0 {
			for _, u := range parse(bytes.TrimSpace(line)) {
				emit(u)
			}
		}
		if readErr != nil {
			if !errors.Is(readErr, io.EOF) {
				_ = killTree(cmd.Process)
			}
			break
		}
	}

	waitErr := cmd.Wait()
	if ctx.Err() != nil {
		return ctx.Err()
	}
	if waitErr != nil {
		var exitErr *exec.ExitError
		if errors.As(waitErr, &exitErr) {
			if tail := stderr.String(); tail != "" {
				return fmt.Errorf("%s exited with code %d: %s", ps.Bin, exitErr.ExitCode(), tail)
			}
			return fmt.Errorf("%s exited with code %d", ps.Bin, exitErr.ExitCode())
		}
		return waitErr
	}
	return nil
}

var (
	resolvedMu sync.Mutex
	resolved   = map[string]string{} // CLI name -> path that answered a probe
)

// lookPath finds a CLI that actually runs. A bare name can match several files
// on PATH: a broken shim (for example a Bun bin under node_modules/.bin) can
// come before the real install, so exec.LookPath's first hit is not enough.
// Each candidate is probed with --version and the first one that exits cleanly
// wins. Successful results are cached; misses are re-checked on the next call.
func lookPath(name string) (string, bool) {
	resolvedMu.Lock()
	cached, ok := resolved[name]
	resolvedMu.Unlock()
	if ok {
		if info, err := os.Stat(cached); err == nil && !info.IsDir() {
			return cached, true
		}
	}
	for _, candidate := range pathCandidates(name) {
		if probeCLI(candidate) {
			resolvedMu.Lock()
			resolved[name] = candidate
			resolvedMu.Unlock()
			return candidate, true
		}
	}
	return "", false
}

// pathCandidates lists every existing file that name could refer to, in PATH order.
func pathCandidates(name string) []string {
	exts := []string{""}
	if runtime.GOOS == "windows" {
		if filepath.Ext(name) == "" {
			for _, e := range strings.Split(os.Getenv("PATHEXT"), ";") {
				if e != "" {
					exts = append(exts, e)
				}
			}
		}
	}
	var out []string
	seen := map[string]bool{}
	for _, dir := range filepath.SplitList(os.Getenv("PATH")) {
		if dir == "" {
			continue
		}
		for _, ext := range exts {
			full := filepath.Join(dir, name+ext)
			if seen[strings.ToLower(full)] {
				continue
			}
			info, err := os.Stat(full)
			if err != nil || info.IsDir() {
				continue
			}
			seen[strings.ToLower(full)] = true
			out = append(out, full)
		}
	}
	return out
}

// probeCLI reports whether path runs and exits 0 for `--version`.
func probeCLI(path string) bool {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, path, "--version")
	configureProcess(cmd)
	return cmd.Run() == nil
}
