package agent

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"orbit/internal/gitdiff"
	"orbit/internal/model"
)

// unsafeName matches what cannot appear in a folder name on Windows or elsewhere.
var unsafeName = regexp.MustCompile(`[^A-Za-z0-9._-]+`)

// safeName turns a project name or branch into one folder name: "feature/login" becomes "feature-login".
func safeName(s, fallback string) string {
	out := strings.Trim(unsafeName.ReplaceAllString(s, "-"), "-.")
	if out == "" {
		return fallback
	}
	return out
}

// worktreeRoot is where a project's worktrees live: <home>\orbit\worktrees\<project>.
func worktreeRoot(projectName string) (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("find your home folder for worktrees: %w", err)
	}
	return filepath.Join(home, "orbit", "worktrees", safeName(projectName, "project")), nil
}

// workspaceFor picks the folder a new agent runs in. No branch means the project folder as it is.
// The branch already checked out there also runs in place. Any other branch gets its own worktree
// under worktreeRoot. NewBranch creates that branch from HEAD first. It returns the folder and the
// branch that folder is on.
func workspaceFor(proj *model.Project, req LaunchRequest) (dir, branch string, err error) {
	branch = strings.TrimSpace(req.Branch)
	if branch == "" {
		if req.NewBranch {
			return "", "", errors.New("name the new branch")
		}
		return proj.RepoPath, "", nil
	}
	current, err := gitdiff.CurrentBranch(proj.RepoPath)
	if err != nil {
		return "", "", err
	}
	if !req.NewBranch && branch == current {
		return proj.RepoPath, branch, nil
	}
	if req.NewBranch {
		if err := gitdiff.ValidBranchName(proj.RepoPath, branch); err != nil {
			return "", "", err
		}
	}
	root, err := worktreeRoot(proj.Name)
	if err != nil {
		return "", "", err
	}
	dir = filepath.Join(root, safeName(branch, "worktree"))
	if _, err := os.Stat(dir); err == nil {
		return "", "", fmt.Errorf("a folder already exists at %s. Choose another branch name or remove that folder", dir)
	}
	if err := gitdiff.AddWorktree(proj.RepoPath, dir, branch, req.NewBranch); err != nil {
		return "", "", err
	}
	return dir, branch, nil
}

// ProjectBranches lists a project's local branches for the launch dialog, with the folder new
// worktrees go in. It fails when the project is not a git repository with at least one commit.
func (m *Manager) ProjectBranches(projectID string) (model.BranchInfo, error) {
	m.mu.Lock()
	proj, ok := m.projects[projectID]
	m.mu.Unlock()
	if !ok {
		return model.BranchInfo{}, errors.New("choose a project first")
	}
	current, err := gitdiff.CurrentBranch(proj.RepoPath)
	if err != nil {
		return model.BranchInfo{}, err
	}
	names, err := gitdiff.Branches(proj.RepoPath)
	if err != nil {
		return model.BranchInfo{}, err
	}
	root, err := worktreeRoot(proj.Name)
	if err != nil {
		return model.BranchInfo{}, err
	}
	if names == nil {
		names = []string{}
	}
	return model.BranchInfo{Current: current, Branches: names, WorktreeRoot: root}, nil
}

// agentDirLocked is the folder an agent works in: its worktree, or the project folder.
func agentDirLocked(rec *model.AgentRecord, proj *model.Project) string {
	if rec.WorkDir != "" {
		return rec.WorkDir
	}
	return proj.RepoPath
}
