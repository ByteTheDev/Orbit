package gitdiff

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// initRepo makes a repository with one committed file, src/a.txt, and returns its path and
// the hash of that first commit.
func initRepo(t *testing.T) (string, string) {
	t.Helper()
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git is not installed")
	}
	dir := t.TempDir()
	run := func(args ...string) string {
		t.Helper()
		cmd := exec.Command("git", append([]string{"-C", dir}, args...)...)
		cmd.Env = append(os.Environ(), "GIT_AUTHOR_NAME=t", "GIT_AUTHOR_EMAIL=t@example.com", "GIT_COMMITTER_NAME=t", "GIT_COMMITTER_EMAIL=t@example.com")
		out, err := cmd.CombinedOutput()
		if err != nil {
			t.Fatalf("git %v: %v\n%s", args, err, out)
		}
		return strings.TrimSpace(string(out))
	}
	run("init", "-q")
	if err := os.MkdirAll(filepath.Join(dir, "src"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "src", "a.txt"), []byte("one\ntwo\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	run("add", "-A")
	run("commit", "-q", "-m", "first")
	return dir, run("rev-parse", "HEAD")
}

func TestStatusOfReportsModifiedAndUntracked(t *testing.T) {
	repo, _ := initRepo(t)
	if st, err := StatusOf(repo, "src/a.txt"); err != nil || st != nil {
		t.Fatalf("clean file should have no status, got %+v, %v", st, err)
	}
	if err := os.WriteFile(filepath.Join(repo, "src", "a.txt"), []byte("one\nthree\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	st, err := StatusOf(repo, "src/a.txt")
	if err != nil || st == nil || st.Worktree != "M" || !st.Unstaged || st.Untracked {
		t.Fatalf("modified file parsed wrong: %+v, %v", st, err)
	}
	if err := os.WriteFile(filepath.Join(repo, "new.txt"), []byte("hi\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	st, err = StatusOf(repo, "new.txt")
	if err != nil || st == nil || !st.Untracked {
		t.Fatalf("untracked file parsed wrong: %+v, %v", st, err)
	}
}

func TestStatusOfRejectsPathsOutsideRepo(t *testing.T) {
	repo, _ := initRepo(t)
	if _, err := StatusOf(repo, "../elsewhere.txt"); err == nil {
		t.Fatal("a path outside the repository must be refused")
	}
}

func TestFileLogAndVersions(t *testing.T) {
	repo, first := initRepo(t)
	if err := os.WriteFile(filepath.Join(repo, "src", "a.txt"), []byte("one\nthree\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command("git", "-C", repo, "commit", "-q", "-am", "second")
	cmd.Env = append(os.Environ(), "GIT_AUTHOR_NAME=t", "GIT_AUTHOR_EMAIL=t@example.com", "GIT_COMMITTER_NAME=t", "GIT_COMMITTER_EMAIL=t@example.com")
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("commit: %v\n%s", err, out)
	}

	log, err := FileLog(repo, "src/a.txt")
	if err != nil || len(log) != 2 || log[1].Hash != first || log[0].Subject != "second" {
		t.Fatalf("file log wrong: %+v, %v", log, err)
	}

	diff, err := CommitFileDiff(repo, log[0].Hash, "src/a.txt")
	if err != nil || !strings.Contains(diff, "-two") || !strings.Contains(diff, "+three") {
		t.Fatalf("commit diff wrong: %q, %v", diff, err)
	}

	content, err := FileAt(repo, first, "src/a.txt")
	if err != nil || content != "one\ntwo\n" {
		t.Fatalf("content at first commit wrong: %q, %v", content, err)
	}
}

func TestFileVersionsRejectBadRevisions(t *testing.T) {
	repo, _ := initRepo(t)
	if _, err := CommitFileDiff(repo, "--output=/tmp/x", "src/a.txt"); err == nil {
		t.Fatal("an option-like revision must be refused")
	}
	if _, err := FileAt(repo, "HEAD", "src/a.txt"); err == nil {
		t.Fatal("only hex commit hashes are accepted")
	}
}

func TestFileLogIsEmptyWithoutCommits(t *testing.T) {
	dir := t.TempDir()
	if out, err := exec.Command("git", "-C", dir, "init", "-q").CombinedOutput(); err != nil {
		t.Fatalf("init: %v\n%s", err, out)
	}
	log, err := FileLog(dir, "missing.txt")
	if err != nil || log == nil || len(log) != 0 {
		t.Fatalf("want an empty, non-nil list, got %v, %v", log, err)
	}
}
