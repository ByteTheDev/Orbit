package gitdiff

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func newTestRepo(t *testing.T) string {
	t.Helper()
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git is not installed")
	}
	dir := t.TempDir()
	run := func(args ...string) string {
		t.Helper()
		cmd := exec.Command("git", append([]string{"-C", dir}, args...)...)
		out, err := cmd.CombinedOutput()
		if err != nil {
			t.Fatalf("git %v: %v\n%s", args, err, out)
		}
		return string(out)
	}
	run("init", "-q", "-b", "main")
	run("config", "user.email", "test@example.com")
	run("config", "user.name", "Test")
	writeFile(t, dir, "a.txt", "one\n")
	run("add", ".")
	run("commit", "-q", "-m", "first")
	return dir
}

func writeFile(t *testing.T, root, rel, content string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(root, filepath.FromSlash(rel)), []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestParseBranchHeader(t *testing.T) {
	cases := []struct {
		in            string
		branch, up    string
		ahead, behind int
	}{
		{"main...origin/main [ahead 2, behind 1]", "main", "origin/main", 2, 1},
		{"main", "main", "", 0, 0},
		{"main...origin/main", "main", "origin/main", 0, 0},
		{"No commits yet on trunk", "trunk", "", 0, 0},
		{"HEAD (no branch)", "", "", 0, 0},
	}
	for _, c := range cases {
		b, u, a, bh := parseBranchHeader(c.in)
		if b != c.branch || u != c.up || a != c.ahead || bh != c.behind {
			t.Errorf("parseBranchHeader(%q) = %q %q %d %d", c.in, b, u, a, bh)
		}
	}
}

func TestStatusReportsBranchAndConflicts(t *testing.T) {
	repo := newTestRepo(t)
	writeFile(t, repo, "a.txt", "changed\n")
	st, err := Status(repo)
	if err != nil {
		t.Fatal(err)
	}
	if st.Branch != "main" || len(st.Changes) != 1 || st.Changes[0].Path != "a.txt" {
		t.Fatalf("unexpected status: %+v", st)
	}
	if st.Remote {
		t.Fatal("a fresh repo has no remote")
	}
	if st.Changes == nil {
		t.Fatal("changes must serialise as []")
	}
}

func TestLogReadsAgentTrailer(t *testing.T) {
	repo := newTestRepo(t)
	writeFile(t, repo, "b.txt", "x\n")
	cmd := exec.Command("git", "-C", repo, "add", ".")
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("%v %s", err, out)
	}
	msg := "Orbit: Ada - add b\n\nOrbit-Agent: Ada"
	cmd = exec.Command("git", "-C", repo, "commit", "-q", "-m", msg)
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("%v %s", err, out)
	}
	commits, err := LogPage(repo, 0, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(commits) != 2 || commits[0].Agent != "Ada" || commits[1].Agent != "" {
		t.Fatalf("agent attribution wrong: %+v", commits)
	}
	page2, err := LogPage(repo, 1, 10)
	if err != nil || len(page2) != 1 || page2[0].Subject != "first" {
		t.Fatalf("paging wrong: %+v %v", page2, err)
	}
}

func TestShowListsFilesWithCounts(t *testing.T) {
	repo := newTestRepo(t)
	writeFile(t, repo, "a.txt", "one\ntwo\n")
	run := func(args ...string) {
		if out, err := exec.Command("git", append([]string{"-C", repo}, args...)...).CombinedOutput(); err != nil {
			t.Fatalf("%v %s", err, out)
		}
	}
	run("add", ".")
	run("commit", "-q", "-m", "edit")
	head, err := LogPage(repo, 0, 1)
	if err != nil {
		t.Fatal(err)
	}
	d, err := Show(repo, head[0].Hash)
	if err != nil {
		t.Fatal(err)
	}
	if len(d.Files) != 1 || d.Files[0].Path != "a.txt" || d.Files[0].Status != "M" || d.Files[0].Additions != 1 {
		t.Fatalf("commit files wrong: %+v", d.Files)
	}
	patch, err := CommitDiff(repo, head[0].Hash, "a.txt", "")
	if err != nil || !strings.Contains(patch, "+two") {
		t.Fatalf("commit diff wrong: %q %v", patch, err)
	}
	if _, err := Show(repo, "--evil"); err == nil {
		t.Fatal("option-like hashes must be refused")
	}
}

func TestDiscardRestoresAndRemovesUntracked(t *testing.T) {
	repo := newTestRepo(t)
	writeFile(t, repo, "a.txt", "changed\n")
	writeFile(t, repo, "new.txt", "fresh\n")
	st, _ := Status(repo)
	var targets []DiscardTarget
	for _, c := range st.Changes {
		targets = append(targets, DiscardTarget{Path: c.Path, Index: c.Index, Worktree: c.Worktree, Untracked: c.Untracked})
	}
	if err := Discard(repo, targets); err != nil {
		t.Fatalf("discard: %v", err)
	}
	if b, _ := os.ReadFile(filepath.Join(repo, "a.txt")); strings.ReplaceAll(string(b), "\r\n", "\n") != "one\n" {
		t.Fatalf("tracked file not restored: %q", b)
	}
	if _, err := os.Stat(filepath.Join(repo, "new.txt")); err == nil {
		t.Fatal("untracked file should be deleted")
	}
	if err := Discard(repo, []DiscardTarget{{Path: "../escape.txt", Worktree: "M"}}); err == nil {
		t.Fatal("paths outside the repo must be refused")
	}
}

func TestSwitchAndCreateBranch(t *testing.T) {
	repo := newTestRepo(t)
	if err := CreateBranch(repo, "feature"); err != nil {
		t.Fatalf("create: %v", err)
	}
	if err := SwitchBranch(repo, "main"); err != nil {
		t.Fatalf("switch: %v", err)
	}
	if err := SwitchBranch(repo, "--force"); err == nil {
		t.Fatal("option-like branch names must be refused")
	}
}

func TestPushWithoutRemoteExplains(t *testing.T) {
	repo := newTestRepo(t)
	if _, err := Push(repo); err == nil || !strings.Contains(err.Error(), "no remote") {
		t.Fatalf("push without a remote should explain, got %v", err)
	}
	if _, err := Fetch(repo); err == nil {
		t.Fatal("fetch without a remote should explain")
	}
}
