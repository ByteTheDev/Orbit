// Package gitdiff returns the working-tree diff for one file in a git repository.
package gitdiff

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"orbit/internal/model"
)

// ErrNotGit is returned when the repository is not under git control.
var ErrNotGit = errors.New("this folder is not a git repository, so no diff is available")

// File returns `git diff HEAD -- <path>` for path inside repo. The path must
// stay inside the repository; the command runs without a shell.
func File(repo, path string) (string, error) {
	rel, err := safeRel(repo, path)
	if err != nil {
		return "", err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()

	var out, stderr bytes.Buffer
	cmd := exec.CommandContext(ctx, "git", "-C", repo, "diff", "--no-color", "HEAD", "--", rel)
	cmd.Stdout = &out
	cmd.Stderr = &stderr
	hideWindow(cmd)
	if err := cmd.Run(); err != nil {
		msg := strings.ToLower(stderr.String())
		if strings.Contains(msg, "not a git repository") {
			return "", ErrNotGit
		}
		return "", fmt.Errorf("git diff failed: %s", strings.TrimSpace(stderr.String()))
	}
	return model.Truncate(out.String(), 200<<10), nil
}

func safeRel(repo, path string) (string, error) {
	if path == "" {
		return "", errors.New("no file path given")
	}
	abs := path
	if !filepath.IsAbs(abs) {
		abs = filepath.Join(repo, path)
	}
	rel, err := filepath.Rel(repo, abs)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return "", errors.New("file is outside the project repository")
	}
	return filepath.ToSlash(rel), nil
}
