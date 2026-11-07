package gitdiff

import (
	"bytes"
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// networkTimeout bounds fetch, pull and push. Those talk to remotes, so they are much slower than
// local commands, but they must still end so the sidebar never waits forever.
const networkTimeout = 3 * time.Minute

// Fetch downloads the remote's new commits and prunes deleted remote branches. It never changes the
// working tree. It returns a one-line summary for the status bar.
func Fetch(repo string) (string, error) {
	if err := requireRemote(repo); err != nil {
		return "", err
	}
	return gitNetwork(repo, "fetch", "--prune")
}

// Pull brings the current branch up to date with its upstream. Divergent history makes a merge
// commit rather than a rebase, and conflicts are left in the working tree for the user to resolve.
func Pull(repo string) (string, error) {
	if err := requireRemote(repo); err != nil {
		return "", err
	}
	writeMu.Lock()
	defer writeMu.Unlock()
	return gitNetwork(repo, "pull", "--no-rebase", "--no-edit")
}

// Push sends the current branch to its remote. A branch without an upstream is pushed to origin and
// its upstream is set, so later pushes need no arguments.
func Push(repo string) (string, error) {
	if err := requireRemote(repo); err != nil {
		return "", err
	}
	branch, err := currentBranchName(repo)
	if err != nil {
		return "", err
	}
	if branch == "" {
		return "", errors.New("HEAD is detached, so there is no branch to push. Switch to a branch first")
	}
	if _, err := git(repo, readTimeout, "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"); err != nil {
		return gitNetwork(repo, "push", "-u", pushRemote(repo), branch)
	}
	return gitNetwork(repo, "push")
}

// GitDirs returns the absolute git folders of repo: its own (per worktree) and the common one that
// holds branches and packed refs. For an ordinary repository the two are the same folder.
func GitDirs(repo string) ([]string, error) {
	out, err := git(repo, readTimeout, "rev-parse", "--absolute-git-dir", "--git-common-dir")
	if err != nil {
		return nil, err
	}
	lines := strings.Split(strings.TrimSpace(out), "\n")
	dirs := []string{}
	for i, l := range lines {
		l = strings.TrimSpace(l)
		if l == "" {
			continue
		}
		if i > 0 && !filepath.IsAbs(l) {
			l = filepath.Join(repo, l)
		}
		dirs = append(dirs, filepath.Clean(l))
	}
	return dirs, nil
}

// HasRemote reports whether the repository has at least one remote configured.
func HasRemote(repo string) bool {
	out, err := git(repo, readTimeout, "remote")
	return err == nil && strings.TrimSpace(out) != ""
}

func requireRemote(repo string) error {
	if !HasRemote(repo) {
		return errors.New("this repository has no remote yet. Add one with git remote add, then try again")
	}
	return nil
}

// pushRemote prefers origin, the usual name, and otherwise uses the first remote listed.
func pushRemote(repo string) string {
	out, _ := git(repo, readTimeout, "remote")
	names := strings.Fields(out)
	for _, n := range names {
		if n == "origin" {
			return n
		}
	}
	if len(names) > 0 {
		return names[0]
	}
	return "origin"
}

func currentBranchName(repo string) (string, error) {
	out, err := git(repo, readTimeout, "symbolic-ref", "--short", "-q", "HEAD")
	if err != nil {
		return "", nil // detached HEAD
	}
	return strings.TrimSpace(out), nil
}

// gitNetwork runs a command that talks to a remote. Credential prompts are disabled, because a
// prompt would wait on a terminal Orbit does not have. Git writes its progress to stderr even when
// it succeeds, so the last line of stderr is returned as the summary.
func gitNetwork(repo string, args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), networkTimeout)
	defer cancel()

	var out, stderr bytes.Buffer
	cmd := exec.CommandContext(ctx, "git", append([]string{"-C", repo}, args...)...)
	cmd.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0", "GCM_INTERACTIVE=never")
	cmd.Stdout = &out
	cmd.Stderr = &stderr
	hideWindow(cmd)
	if err := cmd.Run(); err != nil {
		if ctx.Err() != nil {
			return "", errors.New("the remote did not answer in time. Check the network and try again")
		}
		msg := strings.TrimSpace(stderr.String())
		if msg == "" {
			msg = err.Error()
		}
		return "", errors.New(networkHint(msg))
	}
	lines := strings.Split(strings.TrimSpace(stderr.String()), "\n")
	summary := strings.TrimSpace(lines[len(lines)-1])
	if summary == "" {
		summary = strings.TrimSpace(out.String())
	}
	if summary == "" {
		summary = "Done"
	}
	return summary, nil
}

// networkHint keeps git's first useful line and adds a plain-language hint for common failures.
func networkHint(msg string) string {
	lower := strings.ToLower(msg)
	switch {
	case strings.Contains(lower, "authentication failed") || strings.Contains(lower, "could not read username") || strings.Contains(lower, "permission denied"):
		return "The remote refused the login. Sign in to the remote in git (for example with a credential helper) and try again."
	case strings.Contains(lower, "non-fast-forward") || strings.Contains(lower, "fetch first") || strings.Contains(lower, "rejected"):
		return "The remote has commits you do not have. Pull first, then push again."
	case strings.Contains(lower, "could not resolve host") || strings.Contains(lower, "unable to access"):
		return "Could not reach the remote. Check the network connection."
	case strings.Contains(lower, "conflict") || strings.Contains(lower, "automatic merge failed"):
		return "The pull hit merge conflicts. Resolve them in the Changes list, then commit."
	case strings.Contains(lower, "would be overwritten") || strings.Contains(lower, "please commit your changes or stash"):
		return "Local changes would be overwritten. Commit or discard them first."
	}
	return firstLine(msg)
}

func firstLine(s string) string {
	line, _, _ := strings.Cut(strings.TrimSpace(s), "\n")
	return line
}

// DiscardTarget is one change to throw away. Untracked marks files git has never seen.
type DiscardTarget struct {
	Path      string `json:"path"`
	OldPath   string `json:"oldPath,omitempty"`
	Index     string `json:"index"`
	Worktree  string `json:"worktree"`
	Untracked bool   `json:"untracked"`
}

// Discard throws away uncommitted changes. Untracked files are deleted, newly added files are
// removed from the index and the disk, and every other change is restored to HEAD. Conflicted
// paths are refused: they must be resolved by editing, then staged. The caller confirms first.
func Discard(repo string, targets []DiscardTarget) error {
	if len(targets) == 0 {
		return errors.New("no changes were chosen")
	}
	writeMu.Lock()
	defer writeMu.Unlock()

	var restore, remove []string
	for _, t := range targets {
		rel, err := safeRel(repo, t.Path)
		if err != nil {
			return err
		}
		if isConflicted(t.Index, t.Worktree) {
			return errors.New("“" + t.Path + "” has merge conflicts. Edit the file to resolve them, then stage it")
		}
		switch {
		case t.Untracked:
			if err := removePath(repo, rel); err != nil {
				return err
			}
		case t.Index == "A":
			remove = append(remove, rel)
		case t.Index == "R" || t.Index == "C":
			// A rename: the new path is removed and the old path comes back from HEAD.
			remove = append(remove, rel)
			if t.OldPath != "" {
				oldRel, err := safeRel(repo, t.OldPath)
				if err != nil {
					return err
				}
				restore = append(restore, oldRel)
			}
		default:
			restore = append(restore, rel)
		}
	}
	if len(remove) > 0 {
		if _, err := git(repo, writeTimeout, append([]string{"rm", "-r", "-f", "--quiet", "--ignore-unmatch", "--"}, remove...)...); err != nil {
			return err
		}
	}
	if len(restore) > 0 {
		if !hasHead(repo) {
			return errors.New("this repository has no commits yet, so there is nothing to restore to")
		}
		if _, err := git(repo, writeTimeout, append([]string{"restore", "--source=HEAD", "--staged", "--worktree", "--"}, restore...)...); err != nil {
			return err
		}
	}
	return nil
}

// removePath deletes an untracked file or folder. It refuses anything that resolves outside repo.
func removePath(repo, rel string) error {
	abs := filepath.Join(repo, filepath.FromSlash(rel))
	if rel == "" || strings.EqualFold(strings.Split(rel, "/")[0], ".git") {
		return errors.New("that item cannot be discarded")
	}
	return os.RemoveAll(abs)
}

func isConflicted(x, y string) bool {
	return x == "U" || y == "U" || (x == "A" && y == "A") || (x == "D" && y == "D")
}

// SwitchBranch checks out an existing local branch. Git refuses when local changes would be lost,
// and that refusal is returned as the error.
func SwitchBranch(repo, name string) error {
	if err := ValidBranchName(repo, name); err != nil {
		return err
	}
	writeMu.Lock()
	defer writeMu.Unlock()
	_, err := git(repo, writeTimeout, "switch", name)
	return err
}

// CreateBranch makes a new branch from HEAD and switches to it.
func CreateBranch(repo, name string) error {
	if err := ValidBranchName(repo, name); err != nil {
		return err
	}
	writeMu.Lock()
	defer writeMu.Unlock()
	_, err := git(repo, writeTimeout, "switch", "-c", name)
	return err
}
