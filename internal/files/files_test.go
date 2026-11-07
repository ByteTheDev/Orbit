package files

import (
	"bytes"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// mkProject makes a folder that is a git repository, with .gitignore hiding build/ and *.log.
func mkProject(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	git := func(args ...string) {
		t.Helper()
		cmd := exec.Command("git", append([]string{"-C", root}, args...)...)
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v\n%s", args, err, out)
		}
	}
	git("init", "-q", "-b", "main")
	git("config", "core.autocrlf", "false")
	put(t, root, ".gitignore", "build/\n*.log\n")
	put(t, root, "src/main.go", "package main\n")
	put(t, root, "src/util/helpers.go", "package util\n")
	put(t, root, "README.md", "# hi\n")
	put(t, root, "build/out.bin", "x")
	put(t, root, "debug.log", "x")
	return root
}

func put(t *testing.T, root, rel, content string) {
	t.Helper()
	full := filepath.Join(root, filepath.FromSlash(rel))
	if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(full, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func names(entries []Entry) []string {
	out := make([]string, 0, len(entries))
	for _, e := range entries {
		out = append(out, e.Name)
	}
	return out
}

func TestValidName(t *testing.T) {
	ok := []string{"main.go", "notes", ".env", "my file.txt", "CONSOLE.txt"}
	bad := []string{"", " lead", "trail ", ".", "..", "a/b", `a\b`, "a:b", "what?", "dot.", "CON", "nul.txt", "com1", "LPT9.log"}
	for _, n := range ok {
		if err := ValidName(n); err != nil {
			t.Errorf("ValidName(%q) rejected: %v", n, err)
		}
	}
	for _, n := range bad {
		if err := ValidName(n); err == nil {
			t.Errorf("ValidName(%q) should be rejected", n)
		}
	}
}

func TestResolveKeepsPathsInsideRoot(t *testing.T) {
	root := t.TempDir()
	if _, err := Resolve(root, "src/../README.md"); err != nil {
		t.Errorf("inside path rejected: %v", err)
	}
	for _, rel := range []string{"../outside", "a/../../outside", "/etc/passwd", `C:\Windows`} {
		if _, err := Resolve(root, rel); err == nil {
			t.Errorf("Resolve(%q) should be refused", rel)
		}
	}
}

func TestListHidesIgnoredAndGitAndSortsFoldersFirst(t *testing.T) {
	root := mkProject(t)
	l, err := List(root, "")
	if err != nil {
		t.Fatal(err)
	}
	// Folders first, then files by case-insensitive name. Dot files sort before letters.
	if got := strings.Join(names(l.Entries), ","); got != "src,.gitignore,README.md" {
		t.Fatalf("entries = %s", got)
	}
	for _, e := range l.Entries {
		if e.Name == "build" || e.Name == "debug.log" || e.Name == ".git" {
			t.Errorf("%s should be hidden", e.Name)
		}
	}
	if !l.Entries[0].IsDir {
		t.Error("folders should come first")
	}
}

func TestListOutsideRepositoryShowsEverything(t *testing.T) {
	dir := t.TempDir()
	put(t, dir, "a.txt", "x")
	put(t, dir, "build/out.bin", "x")
	l, err := List(dir, "")
	if err != nil {
		t.Fatal(err)
	}
	if len(l.Entries) != 2 {
		t.Fatalf("a non-repository folder has no ignore rules: %v", names(l.Entries))
	}
}

func TestFindRanksNamePrefixAndSkipsIgnored(t *testing.T) {
	root := mkProject(t)
	m, err := Find(root, "help")
	if err != nil {
		t.Fatal(err)
	}
	if len(m.Entries) != 1 || m.Entries[0].Path != "src/util/helpers.go" {
		t.Fatalf("matches = %+v", m.Entries)
	}
	m, _ = Find(root, "out")
	if len(m.Entries) != 0 {
		t.Fatalf("ignored build/out.bin must not be found: %+v", m.Entries)
	}
	m, _ = Find(root, "main")
	if len(m.Entries) == 0 || m.Entries[0].Path != "src/main.go" {
		t.Fatalf("main should match src/main.go first: %+v", m.Entries)
	}
	empty, _ := Find(root, "   ")
	if empty.Entries == nil || len(empty.Entries) != 0 {
		t.Fatalf("an empty query must return [] not null: %#v", empty.Entries)
	}
}

func TestCreateRenameDeleteRoundTrip(t *testing.T) {
	root := mkProject(t)
	rel, err := Create(root, "src", "new.go", false)
	if err != nil || rel != "src/new.go" {
		t.Fatalf("create: %q %v", rel, err)
	}
	if _, err := Create(root, "src", "new.go", false); err == nil {
		t.Fatal("creating over an existing file must fail")
	}
	dirRel, err := Create(root, "", "docs", true)
	if err != nil || dirRel != "docs" {
		t.Fatalf("create folder: %q %v", dirRel, err)
	}

	renamed, err := Rename(root, "src/new.go", "renamed.go")
	if err != nil || renamed != "src/renamed.go" {
		t.Fatalf("rename: %q %v", renamed, err)
	}
	if _, err := Rename(root, "src/renamed.go", "main.go"); err == nil {
		t.Fatal("renaming onto an existing file must fail")
	}
	if _, err := Rename(root, "src/renamed.go", "bad:name.go"); err == nil {
		t.Fatal("reserved characters must be refused")
	}
	if _, err := Rename(root, "src", "lib"); err != nil {
		t.Fatalf("renaming a folder: %v", err)
	}
	if _, err := os.Stat(filepath.Join(root, "lib", "renamed.go")); err != nil {
		t.Fatalf("folder contents should move with it: %v", err)
	}

	if err := Delete(root, []string{"lib", "docs"}); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(root, "lib")); !os.IsNotExist(err) {
		t.Fatal("folder should be deleted with its contents")
	}
	if err := Delete(root, []string{".git"}); err == nil {
		t.Fatal("the .git folder must never be deleted")
	}
	if err := Delete(root, []string{""}); err == nil {
		t.Fatal("the project root must never be deleted")
	}
}

func TestWriteTextRefusesStaleEditor(t *testing.T) {
	root := mkProject(t)
	text, err := ReadText(root, "README.md")
	if err != nil {
		t.Fatal(err)
	}
	if text.Content != "# hi\n" || text.Binary || text.TooLarge {
		t.Fatalf("read = %+v", text)
	}
	mod, err := WriteText(root, "README.md", "# changed\n", text.ModTime)
	if err != nil {
		t.Fatalf("save with current mod time: %v", err)
	}
	// Another writer changes the file after the editor loaded it.
	put(t, root, "README.md", "# someone else\n")
	os.Chtimes(filepath.Join(root, "README.md"), time.Now().Add(time.Hour), time.Now().Add(time.Hour))
	if _, err := WriteText(root, "README.md", "# mine\n", mod); !errors.Is(err, ErrConflict) {
		t.Fatalf("want ErrConflict, got %v", err)
	}
	if got, _ := os.ReadFile(filepath.Join(root, "README.md")); string(got) != "# someone else\n" {
		t.Fatalf("a refused save must not change the file, got %q", got)
	}
}

func TestReadTextReportsBinaryAndLargeFiles(t *testing.T) {
	root := mkProject(t)
	if err := os.WriteFile(filepath.Join(root, "logo.bin"), []byte{0x89, 'P', 0, 'N', 'G'}, 0o644); err != nil {
		t.Fatal(err)
	}
	bin, err := ReadText(root, "logo.bin")
	if err != nil || !bin.Binary || bin.Content != "" {
		t.Fatalf("binary = %+v %v", bin, err)
	}
	big := bytes.Repeat([]byte("a"), MaxTextBytes+1)
	if err := os.WriteFile(filepath.Join(root, "big.txt"), big, 0o644); err != nil {
		t.Fatal(err)
	}
	large, err := ReadText(root, "big.txt")
	if err != nil || !large.TooLarge || large.Content != "" {
		t.Fatalf("large = %+v %v", large, err)
	}
}

func TestGitMetadataIsNotEditable(t *testing.T) {
	root := mkProject(t)
	if _, err := ReadText(root, ".git/config"); err == nil {
		t.Error("reading inside .git must be refused")
	}
	if _, err := Create(root, ".git", "x", false); err == nil {
		t.Error("creating inside .git must be refused")
	}
}

func TestWatcherReportsChangesInWatchedFolders(t *testing.T) {
	root := mkProject(t)
	got := make(chan Change, 8)
	w, err := NewWatcher(func(c Change) { got <- c })
	if err != nil {
		t.Skipf("file watching unavailable here: %v", err)
	}
	defer w.Stop()
	w.Set("p1", root, nil, []string{"src"})

	// Give the OS a moment to arm the watches before writing.
	time.Sleep(150 * time.Millisecond)
	put(t, root, "src/fresh.go", "package main\n")

	deadline := time.After(5 * time.Second)
	for {
		select {
		case c := <-got:
			for _, d := range c.Dirs {
				if d == "src" {
					if c.ProjectID != "p1" {
						t.Fatalf("project id = %q", c.ProjectID)
					}
					return
				}
			}
		case <-deadline:
			t.Fatal("no change reported for the watched folder")
		}
	}
}
