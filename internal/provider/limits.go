package provider

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strings"
	"sync"
	"time"

	"orbit/internal/model"
)

// limitsTTL is how long a fetched set of limits is reused before the CLIs are asked again.
const limitsTTL = 3 * time.Minute

// limitsTimeout bounds one CLI query. Claude Code takes several seconds to start with its hooks.
const limitsTimeout = 45 * time.Second

// LimitsCache holds the last reading for each provider so the UI can poll without starting a CLI each time.
type LimitsCache struct {
	mu      sync.Mutex
	at      time.Time
	entries []model.ProviderLimits
}

// Get returns the current limits for Claude and Codex. It asks the CLIs again when the cached
// reading is older than limitsTTL, or when force is set. The result is never nil.
func (c *LimitsCache) Get(ctx context.Context, force bool) []model.ProviderLimits {
	c.mu.Lock()
	defer c.mu.Unlock()
	if !force && c.entries != nil && time.Since(c.at) < limitsTTL {
		return c.entries
	}
	c.entries = fetchAllLimits(ctx)
	c.at = time.Now()
	return c.entries
}

// fetchAllLimits asks both CLIs at once, so the slower one does not delay the other.
func fetchAllLimits(ctx context.Context) []model.ProviderLimits {
	var claude, codex model.ProviderLimits
	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		claude = fetchClaudeLimits(ctx)
	}()
	go func() {
		defer wg.Done()
		codex = fetchCodexLimits(ctx)
	}()
	wg.Wait()
	return []model.ProviderLimits{claude, codex}
}

func fetchClaudeLimits(ctx context.Context) model.ProviderLimits {
	now := time.Now().UnixMilli()
	d := Claude{}.Detect()
	if !d.Available {
		return model.ProviderLimits{Provider: "claude", Windows: []model.LimitWindow{}, Error: "Claude Code is not installed.", CheckedAt: now}
	}
	lim, err := queryLimits(ctx, d.Path, []string{"-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose"}, claudeUsageRequests, ParseClaudeUsage)
	if err != nil {
		return model.ProviderLimits{Provider: "claude", Windows: []model.LimitWindow{}, Error: err.Error(), CheckedAt: now}
	}
	lim.CheckedAt = now
	return lim
}

func fetchCodexLimits(ctx context.Context) model.ProviderLimits {
	now := time.Now().UnixMilli()
	d := Codex{}.Detect()
	if !d.Available {
		return model.ProviderLimits{Provider: "codex", Windows: []model.LimitWindow{}, Error: "Codex is not installed.", CheckedAt: now}
	}
	lim, err := queryLimits(ctx, d.Path, []string{"app-server"}, codexLimitsRequests, ParseCodexLimits)
	if err != nil {
		return model.ProviderLimits{Provider: "codex", Windows: []model.LimitWindow{}, Error: err.Error(), CheckedAt: now}
	}
	lim.CheckedAt = now
	return lim
}

// queryLimits starts a CLI, sends its requests on stdin and reads stdout until parse recognises the reply.
// The process is then stopped. No prompt is sent, so no model turn runs.
func queryLimits(ctx context.Context, bin string, args []string, requests []string, parse func([]byte) (model.ProviderLimits, bool)) (model.ProviderLimits, error) {
	ctx, cancel := context.WithTimeout(ctx, limitsTimeout)
	defer cancel()

	// Run in the temp folder so the query never touches a project's repository.
	cmd := exec.CommandContext(ctx, bin, args...)
	cmd.Dir = os.TempDir()
	cmd.WaitDelay = 2 * time.Second
	cmd.Cancel = func() error { return killTree(cmd.Process) }
	configureProcess(cmd)

	stdin, err := cmd.StdinPipe()
	if err != nil {
		return model.ProviderLimits{}, fmt.Errorf("attach stdin: %w", err)
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return model.ProviderLimits{}, fmt.Errorf("attach stdout: %w", err)
	}
	if err := cmd.Start(); err != nil {
		return model.ProviderLimits{}, fmt.Errorf("start %s: %w", bin, err)
	}
	defer func() {
		_ = stdin.Close()
		_ = killTree(cmd.Process)
		_ = cmd.Wait()
	}()

	for _, r := range requests {
		if _, err := io.WriteString(stdin, r+"\n"); err != nil {
			return model.ProviderLimits{}, fmt.Errorf("write to %s: %w", bin, err)
		}
	}

	reader := bufio.NewReaderSize(stdout, 64<<10)
	for {
		line, readErr := reader.ReadBytes('\n')
		if t := strings.TrimSpace(string(line)); t != "" {
			if lim, done := parse([]byte(t)); done {
				return lim, nil
			}
		}
		if readErr != nil {
			if ctx.Err() != nil {
				return model.ProviderLimits{}, errors.New("timed out waiting for the CLI to report its limits")
			}
			return model.ProviderLimits{}, errors.New("the CLI closed without reporting its limits")
		}
	}
}
