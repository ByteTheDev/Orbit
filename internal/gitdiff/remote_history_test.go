package gitdiff

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// rhGit runs git in dir for setup. Line endings are pinned to LF so restores compare exactly on Windows.
func rhGit(t *testing.T, dir string, args ...string) string {
	t.Helper()
	cmd := exec.Command("git", append([]string{"-C", dir}, args...)...)
	cmd.Env = append(os.Environ(), "GIT_AUTHOR_NAME=T", "GIT_AUTHOR_EMAIL=t@example.com", "GIT_COMMITTER_NAME=T", "GIT_COMMITTER_EMAIL=t@example.com")
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %v: %v\n%s", args, err, out)
	}
	return string(out)
}

// rhRepo makes a repository on main with one commit and LF line endings.
func rhRepo(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	rhGit(t, dir, "init", "-q", "-b", "main")
	rhGit(t, dir, "config", "core.autocrlf", "false")
	rhGit(t, dir, "config", "user.name", "T")
	rhGit(t, dir, "config", "user.email", "t@example.com")
	rhPut(t, dir, "a.txt", "one\n")
	rhGit(t, dir, "add", "a.txt")
	rhGit(t, dir, "commit", "-q", "-m", "first")
	return dir
}

func rhPut(t *testing.T, dir, rel, content string) {
	t.Helper()
	full := filepath.Join(dir, filepath.FromSlash(rel))
	if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(full, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestRemoteRoundTripSetsUpstreamAndPullsRemoteWork(t *testing.T) {
	repo := rhRepo(t)
	remote := t.TempDir()
	rhGit(t, remote, "init", "-q", "--bare", "-b", "main")
	rhGit(t, repo, "remote", "add", "origin", remote)

	// The first push has no upstream yet; Push must set one.
	if _, err := Push(repo); err != nil {
		t.Fatalf("first push: %v", err)
	}
	if !strings.Contains(rhGit(t, repo, "rev-parse", "--abbrev-ref", "@{u}"), "origin/main") {
		t.Fatal("push did not set the upstream")
	}

	// A second clone pushes a commit, so this repository is behind after a fetch.
	other := filepath.Join(t.TempDir(), "other")
	rhGit(t, filepath.Dir(other), "clone", "-q", remote, other)
	rhGit(t, other, "config", "core.autocrlf", "false")
	rhGit(t, other, "config", "user.name", "T")
	rhGit(t, other, "config", "user.email", "t@example.com")
	rhPut(t, other, "from-other.txt", "hi\n")
	rhGit(t, other, "add", "from-other.txt")
	rhGit(t, other, "commit", "-q", "-m", "from other")
	if _, err := Push(other); err != nil {
		t.Fatal(err)
	}

	if _, err := Fetch(repo); err != nil {
		t.Fatal(err)
	}
	if st, _ := Status(repo); st.Behind != 1 {
		t.Fatalf("after fetch want behind 1, got %+v", st)
	}
	summary, err := Pull(repo)
	if err != nil {
		t.Fatal(err)
	}
	if summary == "" {
		t.Error("pull should return a summary line")
	}
	if b, _ := os.ReadFile(filepath.Join(repo, "from-other.txt")); string(b) != "hi\n" {
		t.Fatal("pull did not bring the remote file")
	}
}

func TestFetchWithoutRemoteExplainsItself(t *testing.T) {
	repo := rhRepo(t)
	if _, err := Fetch(repo); err == nil || !strings.Contains(err.Error(), "no remote") {
		t.Fatalf("fetch without remote: %v", err)
	}
}

func TestLogPageSkipsAndCarriesAgent(t *testing.T) {
	repo := rhRepo(t)
	rhPut(t, repo, "agent.txt", "x\n")
	rhGit(t, repo, "add", "agent.txt")
	rhGit(t, repo, "commit", "-q", "-m", "Orbit: Nova - add\n\nOrbit-Agent: Nova")

	first, err := LogPage(repo, 0, 1)
	if err != nil || len(first) != 1 || first[0].Agent != "Nova" {
		t.Fatalf("first page = %+v %v", first, err)
	}
	second, err := LogPage(repo, 1, 10)
	if err != nil || len(second) != 1 || second[0].Subject != "first" || second[0].Agent != "" {
		t.Fatalf("second page = %+v %v", second, err)
	}
	if none, _ := LogPage(repo, 50, 10); none == nil || len(none) != 0 {
		t.Fatalf("a page past the end must be an empty non-nil slice, got %#v", none)
	}
}

func TestParseNumstatRenameUsesNewPath(t *testing.T) {
	counts := parseNumstat("3\t1\t\x00old.go\x00new.go\x00-\t-\tlogo.png\x00")
	if c := counts["new.go"]; c != [3]int{3, 1, 0} {
		t.Errorf("rename counts = %v", c)
	}
	if c := counts["logo.png"]; c[2] != 1 {
		t.Errorf("binary flag missing: %v", c)
	}
}

func TestIgnoredPathsReportsFoldersAndKeepsTrackedFiles(t *testing.T) {
	repo := rhRepo(t)
	rhPut(t, repo, ".gitignore", "build/\n*.log\n")
	rhPut(t, repo, "build/out.bin", "x")
	rhPut(t, repo, "debug.log", "x")
	rhPut(t, repo, "src.go", "x")
	ignored, err := IgnoredPaths(repo, []string{"build/", "debug.log", "src.go"})
	if err != nil {
		t.Fatal(err)
	}
	if !ignored["build/"] || !ignored["debug.log"] || ignored["src.go"] {
		t.Fatalf("ignored = %v", ignored)
	}
	// a.txt is tracked, so a matching pattern must not hide it.
	rhPut(t, repo, ".gitignore", "*.txt\n")
	ignored, _ = IgnoredPaths(repo, []string{"a.txt"})
	if ignored["a.txt"] {
		t.Fatal("tracked files are never ignored")
	}
}

func TestGitDirsForLinkedWorktree(t *testing.T) {
	repo := rhRepo(t)
	wt := filepath.Join(t.TempDir(), "wt")
	rhGit(t, repo, "worktree", "add", "-q", "-b", "wt-branch", wt)
	dirs, err := GitDirs(wt)
	if err != nil {
		t.Fatal(err)
	}
	if len(dirs) != 2 || dirs[0] == dirs[1] {
		t.Fatalf("a worktree has its own git folder and a shared one, got %v", dirs)
	}
	if !strings.Contains(dirs[0], "worktrees") {
		t.Fatalf("first dir should be the worktree's own git folder, got %v", dirs)
	}
}

func TestMergeConflictIsCountedAndDiscardRefused(t *testing.T) {
	repo := rhRepo(t)
	rhGit(t, repo, "switch", "-q", "-c", "feature")
	rhPut(t, repo, "a.txt", "feature\n")
	rhGit(t, repo, "commit", "-q", "-am", "feature edit")
	rhGit(t, repo, "switch", "-q", "main")
	rhPut(t, repo, "a.txt", "main\n")
	rhGit(t, repo, "commit", "-q", "-am", "main edit")
	_ = exec.Command("git", "-C", repo, "merge", "feature").Run() // non-zero exit is the conflict

	st, err := Status(repo)
	if err != nil {
		t.Fatal(err)
	}
	if st.Conflicts != 1 {
		t.Fatalf("conflicts = %d, want 1 (%+v)", st.Conflicts, st.Changes)
	}
	err = Discard(repo, []DiscardTarget{{Path: "a.txt", Index: "U", Worktree: "U"}})
	if err == nil || !strings.Contains(err.Error(), "conflicts") {
		t.Fatalf("discarding a conflicted file must be refused, got %v", err)
	}
}
