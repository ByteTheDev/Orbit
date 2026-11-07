package gitdiff

import (
	"bytes"
	"context"
	"errors"
	"os/exec"
	"strconv"
	"strings"
	"sync"
	"time"

	"orbit/internal/model"
)

// Timeouts for git commands. Writes can run commit hooks, so they get longer.
const (
	readTimeout  = 15 * time.Second
	writeTimeout = 60 * time.Second
)

// writeMu serialises index and commit operations. Two agents finishing at once would
// otherwise race on .git/index.lock.
var writeMu sync.Mutex

// RepoStatus is the branch and the uncommitted changes of a repository.
type RepoStatus struct {
	// Branch is empty when HEAD is detached.
	Branch     string   `json:"branch"`
	HasCommits bool     `json:"hasCommits"`
	Changes    []Change `json:"changes"`
}

// Change is one path with uncommitted work. A path can be both staged and unstaged.
type Change struct {
	Path string `json:"path"`
	// OldPath is set for renames.
	OldPath   string `json:"oldPath,omitempty"`
	Staged    bool   `json:"staged"`
	Unstaged  bool   `json:"unstaged"`
	Untracked bool   `json:"untracked"`
	// Index and Worktree are git's one-letter codes (M, A, D, R, U, ?, space).
	Index    string `json:"index"`
	Worktree string `json:"worktree"`
}

// CommitInfo is one entry in the recent history.
type CommitInfo struct {
	Hash    string `json:"hash"`
	Short   string `json:"short"`
	Subject string `json:"subject"`
	Author  string `json:"author"`
	At      int64  `json:"at"` // unix milliseconds
}

// Status reads the branch and every changed path. Untracked files are listed one by one.
func Status(repo string) (RepoStatus, error) {
	out, err := git(repo, readTimeout, "status", "--porcelain=v1", "-z", "--untracked-files=all")
	if err != nil {
		return RepoStatus{}, err
	}
	st := RepoStatus{Changes: parseStatus(out), HasCommits: hasHead(repo)}
	// symbolic-ref fails on a detached HEAD, which leaves the branch empty.
	if branch, err := git(repo, readTimeout, "symbolic-ref", "--short", "-q", "HEAD"); err == nil {
		st.Branch = strings.TrimSpace(branch)
	}
	return st, nil
}

// parseStatus reads `git status --porcelain=v1 -z`. Each entry is "XY path"; renames and
// copies add the original path as the next NUL-separated field.
func parseStatus(out string) []Change {
	changes := []Change{}
	fields := strings.Split(out, "\x00")
	for i := 0; i < len(fields); i++ {
		f := fields[i]
		if len(f) < 4 {
			continue
		}
		x, y := f[0], f[1]
		c := Change{Path: f[3:], Index: string(x), Worktree: string(y)}
		c.Untracked = x == '?' && y == '?'
		c.Staged = !c.Untracked && x != ' '
		c.Unstaged = c.Untracked || y != ' '
		if x == 'R' || x == 'C' || y == 'R' || y == 'C' {
			if i+1 < len(fields) {
				c.OldPath = fields[i+1]
				i++
			}
		}
		changes = append(changes, c)
	}
	return changes
}

// Diff returns the diff for one path. staged compares the index with HEAD; otherwise it
// compares the working tree with the index. An untracked file is shown as all added.
func Diff(repo, path string, staged, untracked bool) (string, error) {
	rel, err := safeRel(repo, path)
	if err != nil {
		return "", err
	}
	var out string
	if untracked {
		// git diff --no-index exits with 1 when the files differ, which is the normal case here.
		out, err = gitAllowDiffExit(repo, "diff", "--no-color", "--no-index", "--", "/dev/null", rel)
	} else {
		args := []string{"diff", "--no-color"}
		if staged {
			args = append(args, "--cached")
		}
		out, err = git(repo, readTimeout, append(args, "--", rel)...)
	}
	if err != nil {
		return "", err
	}
	return model.Truncate(out, 200<<10), nil
}

// Log returns up to limit recent commits on the current HEAD. A repository with no
// commits yields an empty list.
func Log(repo string, limit int) ([]CommitInfo, error) {
	commits := []CommitInfo{}
	if !hasHead(repo) {
		return commits, nil
	}
	if limit < 1 {
		limit = 1
	}
	out, err := git(repo, readTimeout, "log", "-n", strconv.Itoa(limit), "--no-color",
		"--pretty=format:%H%x1f%h%x1f%an%x1f%at%x1f%s%x1e")
	if err != nil {
		return nil, err
	}
	for _, rec := range strings.Split(out, "\x1e") {
		rec = strings.Trim(rec, "\r\n")
		if rec == "" {
			continue
		}
		parts := strings.SplitN(rec, "\x1f", 5)
		if len(parts) != 5 {
			continue
		}
		at, _ := strconv.ParseInt(parts[3], 10, 64)
		commits = append(commits, CommitInfo{
			Hash: parts[0], Short: parts[1], Author: parts[2], At: at * 1000, Subject: parts[4],
		})
	}
	return commits, nil
}

// Stage adds the given paths to the index. Deleted files are staged as deletions.
func Stage(repo string, paths []string) error {
	rels, err := relPaths(repo, paths)
	if err != nil {
		return err
	}
	writeMu.Lock()
	defer writeMu.Unlock()
	_, err = git(repo, writeTimeout, append([]string{"add", "--all", "--"}, rels...)...)
	return err
}

// Unstage removes the given paths from the index and leaves the working tree alone.
func Unstage(repo string, paths []string) error {
	rels, err := relPaths(repo, paths)
	if err != nil {
		return err
	}
	writeMu.Lock()
	defer writeMu.Unlock()
	if hasHead(repo) {
		_, err = git(repo, writeTimeout, append([]string{"reset", "-q", "--"}, rels...)...)
	} else {
		_, err = git(repo, writeTimeout, append([]string{"rm", "-r", "--cached", "-q", "--ignore-unmatch", "--"}, rels...)...)
	}
	return err
}

// Commit records a commit and returns its short hash. With paths, only those paths are
// committed, and anything else already staged stays staged. Without paths, the whole index
// is committed.
func Commit(repo, message string, paths []string) (string, error) {
	msg := strings.TrimSpace(message)
	if msg == "" {
		return "", errors.New("write a commit message first")
	}
	if len(msg) > 4000 {
		return "", errors.New("the commit message is too long (4000 characters at most)")
	}
	args := []string{"commit", "-q", "-m", msg}
	var rels []string
	if len(paths) > 0 {
		var err error
		if rels, err = relPaths(repo, paths); err != nil {
			return "", err
		}
	}

	writeMu.Lock()
	defer writeMu.Unlock()
	if len(rels) > 0 {
		// Stage first so new files are known to git; then --only commits just these paths.
		if _, err := git(repo, writeTimeout, append([]string{"add", "--all", "--"}, rels...)...); err != nil {
			return "", err
		}
		args = append(append(args, "--"), rels...)
	}
	if _, err := git(repo, writeTimeout, args...); err != nil {
		return "", err
	}
	short, err := git(repo, readTimeout, "rev-parse", "--short", "HEAD")
	return strings.TrimSpace(short), err
}

// relPaths converts paths to repo-relative slash paths, rejecting any outside the repo.
func relPaths(repo string, paths []string) ([]string, error) {
	if len(paths) == 0 {
		return nil, errors.New("no files were chosen")
	}
	rels := make([]string, 0, len(paths))
	for _, p := range paths {
		rel, err := safeRel(repo, p)
		if err != nil {
			return nil, err
		}
		rels = append(rels, rel)
	}
	return rels, nil
}

func hasHead(repo string) bool {
	_, err := git(repo, readTimeout, "rev-parse", "--verify", "-q", "HEAD")
	return err == nil
}

// git runs git inside repo and returns stdout. A failure becomes an error carrying git's own
// message, so the user sees why (for example, a missing user.name).
func git(repo string, timeout time.Duration, args ...string) (string, error) {
	out, err := gitRun(repo, timeout, false, args...)
	return out, err
}

// gitAllowDiffExit is git for `diff --no-index`, where exit status 1 means "files differ".
func gitAllowDiffExit(repo string, args ...string) (string, error) {
	return gitRun(repo, readTimeout, true, args...)
}

func gitRun(repo string, timeout time.Duration, allowExit1 bool, args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	var out, stderr bytes.Buffer
	cmd := exec.CommandContext(ctx, "git", append([]string{"-C", repo}, args...)...)
	cmd.Stdout = &out
	cmd.Stderr = &stderr
	hideWindow(cmd)
	if err := cmd.Run(); err != nil {
		var exitErr *exec.ExitError
		if allowExit1 && errors.As(err, &exitErr) && exitErr.ExitCode() == 1 {
			return out.String(), nil
		}
		msg := strings.TrimSpace(stderr.String())
		if strings.Contains(strings.ToLower(msg), "not a git repository") {
			return "", ErrNotGit
		}
		if msg == "" {
			msg = err.Error()
		}
		return "", errors.New(msg)
	}
	return out.String(), nil
}
