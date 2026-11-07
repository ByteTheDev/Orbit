package gitdiff

import (
	"errors"
	"regexp"
	"strconv"
	"strings"

	"orbit/internal/model"
)

// FileState is git's view of one path, the same codes the Changes tab shows.
type FileState struct {
	Index     string `json:"index"`
	Worktree  string `json:"worktree"`
	Staged    bool   `json:"staged"`
	Unstaged  bool   `json:"unstaged"`
	Untracked bool   `json:"untracked"`
	OldPath   string `json:"oldPath,omitempty"`
}

// fileLogLimit caps the history a file inspector loads. The UI shows the newest commits first.
const fileLogLimit = 50

var revPattern = regexp.MustCompile(`^[0-9a-f]{7,40}$`)

// Rel returns the slash-separated path of path inside repo. It rejects paths outside the repository.
func Rel(repo, path string) (string, error) {
	return safeRel(repo, path)
}

// StatusOf returns git's status for one path, or nil when the path has no uncommitted change.
func StatusOf(repo, path string) (*FileState, error) {
	rel, err := safeRel(repo, path)
	if err != nil {
		return nil, err
	}
	out, err := git(repo, readTimeout, "--literal-pathspecs", "status", "--porcelain=v1", "-z", "--untracked-files=all", "--", rel)
	if err != nil {
		return nil, err
	}
	changes := parseStatus(out)
	if len(changes) == 0 {
		return nil, nil
	}
	c := changes[0]
	return &FileState{
		Index:     c.Index,
		Worktree:  c.Worktree,
		Staged:    c.Staged,
		Unstaged:  c.Unstaged,
		Untracked: c.Untracked,
		OldPath:   c.OldPath,
	}, nil
}

// FileLog returns up to limit commits that changed path, newest first. A repository without
// commits yields an empty list.
func FileLog(repo, path string) ([]CommitInfo, error) {
	rel, err := safeRel(repo, path)
	if err != nil {
		return nil, err
	}
	commits := []CommitInfo{}
	if !hasHead(repo) {
		return commits, nil
	}
	out, err := git(repo, readTimeout, "--literal-pathspecs", "log", "--no-color", "-n", strconv.Itoa(fileLogLimit),
		"--pretty=format:%H%x1f%h%x1f%an%x1f%at%x1f%s%x1e", "--", rel)
	if err != nil {
		return nil, err
	}
	for _, rec := range strings.Split(out, "\x1e") {
		rec = strings.Trim(rec, "\r\n")
		if rec == "" {
			continue
		}
		parts := strings.SplitN(rec, "\x1f", 5)
		if len(parts) != 5 {
			continue
		}
		at, _ := strconv.ParseInt(parts[3], 10, 64)
		commits = append(commits, CommitInfo{Hash: parts[0], Short: parts[1], Author: parts[2], At: at * 1000, Subject: parts[4]})
	}
	return commits, nil
}

// CommitFileDiff returns the change one commit made to path, against its first parent.
func CommitFileDiff(repo, rev, path string) (string, error) {
	rel, err := safeRel(repo, path)
	if err != nil {
		return "", err
	}
	if !revPattern.MatchString(rev) {
		return "", errors.New("that commit is not valid")
	}
	out, err := git(repo, readTimeout, "--literal-pathspecs", "show", "--no-color", "--format=", "--first-parent", rev, "--", rel)
	if err != nil {
		return "", err
	}
	return model.Truncate(out, 200<<10), nil
}

// FileAt returns the content of path as it was in commit rev. Binary files are refused.
func FileAt(repo, rev, path string) (string, error) {
	rel, err := safeRel(repo, path)
	if err != nil {
		return "", err
	}
	if !revPattern.MatchString(rev) {
		return "", errors.New("that commit is not valid")
	}
	out, err := git(repo, readTimeout, "show", "--no-color", rev+":"+rel)
	if err != nil {
		return "", errors.New("this file did not exist in that commit")
	}
	if strings.ContainsRune(out, 0) {
		return "", errors.New("this file is binary, so it has no text to show")
	}
	return model.Truncate(out, 1<<20), nil
}
