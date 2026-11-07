package agent

import (
	"os/exec"
	"strings"
	"testing"

	"orbit/internal/gitdiff"
)

func TestSetBranchMovesAnAgentIntoAWorktreeAndStartsAFreshSession(t *testing.T) {
	repo, _ := gitRepo(t)
	m, _, _ := newTestManager(t)
	m.providers["fake"] = fakeProvider{}
	proj, err := m.CreateProject("SuperStar", repo)
	if err != nil {
		t.Fatal(err)
	}
	if out, err := exec.Command("git", "-C", repo, "branch", "feature/login").CombinedOutput(); err != nil {
		t.Fatalf("git branch: %v\n%s", err, out)
	}
	a, err := m.Launch(LaunchRequest{ProjectID: proj.ID, Provider: "fake"})
	if err != nil {
		t.Fatal(err)
	}

	got, err := m.SetBranch(a.ID, "feature/login")
	if err != nil {
		t.Fatalf("SetBranch: %v", err)
	}
	if got.Branch != "feature/login" {
		t.Fatalf("branch = %q, want feature/login", got.Branch)
	}
	m.mu.Lock()
	rec := m.agents[a.ID]
	m.mu.Unlock()
	if rec.WorkDir == "" || rec.WorkDir == repo || !strings.Contains(rec.WorkDir, "feature-login") {
		t.Fatalf("workDir = %q, want the feature/login worktree", rec.WorkDir)
	}
	if rec.SessionSeen {
		t.Fatal("session still marked seen, so the next turn would resume the old folder's session")
	}
}

func TestSetBranchToTheProjectsOwnBranchUsesTheProjectFolder(t *testing.T) {
	repo, _ := gitRepo(t)
	m, _, _ := newTestManager(t)
	m.providers["fake"] = fakeProvider{}
	proj, err := m.CreateProject("SuperStar", repo)
	if err != nil {
		t.Fatal(err)
	}
	current, err := gitdiff.CurrentBranch(repo)
	if err != nil {
		t.Fatal(err)
	}
	a, err := m.Launch(LaunchRequest{ProjectID: proj.ID, Provider: "fake"})
	if err != nil {
		t.Fatal(err)
	}

	if _, err := m.SetBranch(a.ID, current); err != nil {
		t.Fatalf("SetBranch to the current branch: %v", err)
	}
	m.mu.Lock()
	rec := m.agents[a.ID]
	m.mu.Unlock()
	if rec.WorkDir != "" {
		t.Fatalf("workDir = %q, want the project folder", rec.WorkDir)
	}
}

func TestSetBranchRejectsAnUnknownAgentAndKeepsItsWorkspace(t *testing.T) {
	m, _, _ := newTestManager(t)
	if _, err := m.SetBranch("no-such-agent", "main"); err == nil {
		t.Fatal("expected an error for an unknown agent")
	}
}
