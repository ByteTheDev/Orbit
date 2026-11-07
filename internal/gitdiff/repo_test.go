package gitdiff

import "testing"

func TestParseStatus(t *testing.T) {
	// Entries are NUL-terminated. A rename carries its original path as the next field.
	out := " M internal/a.go\x00M  staged.go\x00?? new.txt\x00R  renamed.go\x00old.go\x00MM both.go\x00"
	got := parseStatus(out)
	if len(got) != 5 {
		t.Fatalf("want 5 changes, got %d: %+v", len(got), got)
	}

	modified := got[0]
	if modified.Path != "internal/a.go" || modified.Staged || !modified.Unstaged || modified.Untracked {
		t.Errorf("unstaged modification parsed wrong: %+v", modified)
	}

	staged := got[1]
	if staged.Path != "staged.go" || !staged.Staged || staged.Unstaged {
		t.Errorf("staged change parsed wrong: %+v", staged)
	}

	untracked := got[2]
	if untracked.Path != "new.txt" || !untracked.Untracked || untracked.Staged || !untracked.Unstaged {
		t.Errorf("untracked file parsed wrong: %+v", untracked)
	}

	renamed := got[3]
	if renamed.Path != "renamed.go" || renamed.OldPath != "old.go" || !renamed.Staged {
		t.Errorf("rename parsed wrong: %+v", renamed)
	}

	both := got[4]
	if !both.Staged || !both.Unstaged || both.Path != "both.go" {
		t.Errorf("path changed in index and worktree parsed wrong: %+v", both)
	}
}

func TestParseStatusEmptyIsNotNil(t *testing.T) {
	if got := parseStatus(""); got == nil || len(got) != 0 {
		t.Fatalf("want an empty non-nil slice so JSON gets [], got %#v", got)
	}
}
