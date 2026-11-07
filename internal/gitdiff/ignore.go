package gitdiff

import (
	"bytes"
	"context"
	"errors"
	"os/exec"
	"strings"
)

// IgnoredPaths reports which of paths git ignores under repo. Paths are repo-relative and slash
// separated. A trailing slash marks a folder, so folder-only patterns such as "build/" match.
// Tracked files are never reported, because git does not ignore what it already tracks. Outside a
// repository it returns ErrNotGit.
func IgnoredPaths(repo string, paths []string) (map[string]bool, error) {
	ignored := map[string]bool{}
	if len(paths) == 0 {
		return ignored, nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), readTimeout)
	defer cancel()

	var out, stderr bytes.Buffer
	cmd := exec.CommandContext(ctx, "git", "-C", repo, "check-ignore", "-z", "--stdin")
	cmd.Stdin = strings.NewReader(strings.Join(paths, "\x00") + "\x00")
	cmd.Stdout = &out
	cmd.Stderr = &stderr
	hideWindow(cmd)
	if err := cmd.Run(); err != nil {
		var exitErr *exec.ExitError
		// Exit status 1 means no path was ignored, which is the common case.
		if errors.As(err, &exitErr) && exitErr.ExitCode() == 1 {
			return ignored, nil
		}
		if strings.Contains(strings.ToLower(stderr.String()), "not a git repository") {
			return nil, ErrNotGit
		}
		return nil, errors.New(firstNonEmpty(strings.TrimSpace(stderr.String()), err.Error()))
	}
	for _, p := range strings.Split(out.String(), "\x00") {
		if p != "" {
			ignored[p] = true
		}
	}
	return ignored, nil
}

// ListFiles returns every file git sees in repo: tracked files and untracked files that are not
// ignored. The list is what a name search runs over, so it never includes ignored folders.
func ListFiles(repo string) ([]string, error) {
	out, err := git(repo, readTimeout, "ls-files", "-z", "--cached", "--others", "--exclude-standard")
	if err != nil {
		return nil, err
	}
	files := []string{}
	for _, p := range strings.Split(out, "\x00") {
		if p != "" {
			files = append(files, p)
		}
	}
	return files, nil
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return ""
}
