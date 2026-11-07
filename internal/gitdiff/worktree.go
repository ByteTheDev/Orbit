package gitdiff

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
)

// CurrentBranch returns the branch checked out in repo. It is empty when HEAD is detached.
func CurrentBranch(repo string) (string, error) {
	out, err := git(repo, readTimeout, "rev-parse", "--abbrev-ref", "HEAD")
	if err != nil {
		return "", err
	}
	name := strings.TrimSpace(out)
	if name == "HEAD" {
		return "", nil
	}
	return name, nil
}

// Branches lists the local branches of repo, sorted by name.
func Branches(repo string) ([]string, error) {
	out, err := git(repo, readTimeout, "for-each-ref", "--format=%(refname:short)", "--sort=refname", "refs/heads")
	if err != nil {
		return nil, err
	}
	var names []string
	for _, line := range strings.Split(out, "\n") {
		if name := strings.TrimSpace(line); name != "" {
			names = append(names, name)
		}
	}
	return names, nil
}

// ValidBranchName reports whether name can be used as a new branch name, using git's own rules.
func ValidBranchName(repo, name string) error {
	if strings.TrimSpace(name) == "" {
		return errors.New("name the new branch")
	}
	if _, err := git(repo, readTimeout, "check-ref-format", "--branch", name); err != nil {
		return errors.New("“" + name + "” is not a valid branch name")
	}
	return nil
}

// AddWorktree checks branch out into a new worktree folder at dir. With create set, the branch is
// made from HEAD first; otherwise it must already exist. The folder's parent is created if needed.
func AddWorktree(repo, dir, branch string, create bool) error {
	if err := os.MkdirAll(filepath.Dir(dir), 0o755); err != nil {
		return err
	}
	writeMu.Lock()
	defer writeMu.Unlock()
	args := []string{"worktree", "add", dir, branch}
	if create {
		args = []string{"worktree", "add", "-b", branch, dir}
	}
	_, err := git(repo, writeTimeout, args...)
	return err
}
