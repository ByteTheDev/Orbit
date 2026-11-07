package agent

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"orbit/internal/gitdiff"
	"orbit/internal/model"
)

// gitRepo makes a repository with one commit on its default branch, and points the home folder at
// a temp dir so worktrees land there rather than in the real profile.
func gitRepo(t *testing.T) (repo, home string) {
	t.Helper()
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git is not installed")
	}
	home = t.TempDir()
	t.Setenv("USERPROFILE", home)
	t.Setenv("HOME", home)
	repo = filepath.Join(t.TempDir(), "SuperStar")
	if err := os.MkdirAll(repo, 0o755); err != nil {
		t.Fatal(err)
	}
	run := func(args ...string) {
		t.Helper()
		cmd := exec.Command("git", append([]string{"-C", repo, "-c", "user.name=Test", "-c", "user.email=test@example.com"}, args...)...)
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v\n%s", args, err, out)
		}
	}
	run("init", "-q")
	if err := os.WriteFile(filepath.Join(repo, "README.md"), []byte("hi\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	run("add", "README.md")
	run("commit", "-q", "-m", "init")
	return repo, home
}

func TestSafeName(t *testing.T) {
	cases := map[string]string{
		"feature/login": "feature-login",
		"My App!":       "My-App",
		"  ":            "project",
		"..":            "project",
	}
	for in, want := range cases {
		if got := safeName(in, "project"); got != want {
			t.Errorf("safeName(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestWorkspaceForProjectFolderAndCurrentBranch(t *testing.T) {
	repo, _ := gitRepo(t)
	proj := &model.Project{Name: "SuperStar", RepoPath: repo}
	current, err := gitdiff.CurrentBranch(repo)
	if err != nil || current == "" {
		t.Fatalf("current branch = %q, %v", current, err)
	}

	dir, branch, err := workspaceFor(proj, LaunchRequest{})
	if err != nil || dir != repo || branch != "" {
		t.Fatalf("no branch: got (%q, %q, %v), want the project folder", dir, branch, err)
	}
	dir, branch, err = workspaceFor(proj, LaunchRequest{Branch: current})
	if err != nil || dir != repo || branch != current {
		t.Fatalf("current branch: got (%q, %q, %v), want the project folder", dir, branch, err)
	}
}

func TestWorkspaceForNewBranchGetsWorktree(t *testing.T) {
	repo, home := gitRepo(t)
	proj := &model.Project{Name: "SuperStar", RepoPath: repo}

	dir, branch, err := workspaceFor(proj, LaunchRequest{Branch: "feature/login", NewBranch: true})
	if err != nil {
		t.Fatal(err)
	}
	want := filepath.Join(home, "orbit", "worktrees", "SuperStar", "feature-login")
	if dir != want || branch != "feature/login" {
		t.Fatalf("got (%q, %q), want (%q, feature/login)", dir, branch, want)
	}
	if _, err := os.Stat(filepath.Join(dir, "README.md")); err != nil {
		t.Fatalf("worktree has no checkout: %v", err)
	}
	names, err := gitdiff.Branches(repo)
	if err != nil || !contains(names, "feature/login") {
		t.Fatalf("branches = %v, %v; want feature/login", names, err)
	}
}

func TestWorkspaceForExistingBranchGetsWorktree(t *testing.T) {
	repo, home := gitRepo(t)
	proj := &model.Project{Name: "SuperStar", RepoPath: repo}
	if out, err := exec.Command("git", "-C", repo, "branch", "feature/search").CombinedOutput(); err != nil {
		t.Fatalf("git branch: %v\n%s", err, out)
	}

	dir, branch, err := workspaceFor(proj, LaunchRequest{Branch: "feature/search"})
	if err != nil {
		t.Fatal(err)
	}
	want := filepath.Join(home, "orbit", "worktrees", "SuperStar", "feature-search")
	if dir != want || branch != "feature/search" {
		t.Fatalf("got (%q, %q), want (%q, feature/search)", dir, branch, want)
	}

	// The same branch cannot be checked out twice, so a second agent on it is refused.
	if _, _, err := workspaceFor(proj, LaunchRequest{Branch: "feature/search"}); err == nil {
		t.Fatal("a branch already in a worktree should be refused for a second agent")
	}
}

func TestWorkspaceForRejectsBadBranchNames(t *testing.T) {
	repo, _ := gitRepo(t)
	proj := &model.Project{Name: "SuperStar", RepoPath: repo}
	if _, _, err := workspaceFor(proj, LaunchRequest{Branch: "bad..name", NewBranch: true}); err == nil {
		t.Fatal("expected an invalid branch name to be refused")
	}
	if _, _, err := workspaceFor(proj, LaunchRequest{NewBranch: true}); err == nil {
		t.Fatal("expected a new branch with no name to be refused")
	}
}

func contains(list []string, s string) bool {
	for _, v := range list {
		if v == s {
			return true
		}
	}
	return false
}
