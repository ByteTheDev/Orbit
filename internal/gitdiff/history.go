package gitdiff

import (
	"errors"
	"regexp"
	"strconv"
	"strings"

	"orbit/internal/model"
)

// AgentTrailer is the commit trailer Orbit writes on auto-commits. It names the agent that wrote the
// files. Only commits made by Orbit carry it, so attribution is never guessed.
const AgentTrailer = "Orbit-Agent"

// CommitFile is one file a commit touched.
type CommitFile struct {
	Path      string `json:"path"`
	OldPath   string `json:"oldPath,omitempty"`
	Status    string `json:"status"` // A added, M modified, D deleted, R renamed, C copied, T type changed
	Additions int    `json:"additions"`
	Deletions int    `json:"deletions"`
	Binary    bool   `json:"binary"`
}

// CommitDetail is one commit with the files it changed.
type CommitDetail struct {
	CommitInfo
	Body  string       `json:"body"`
	Files []CommitFile `json:"files"`
}

var hexHash = regexp.MustCompile(`^[0-9a-fA-F]{4,64}$`)

// LogPage returns up to limit commits on HEAD, starting skip commits back. Each carries the agent
// named by its Orbit-Agent trailer, when it has one.
func LogPage(repo string, skip, limit int) ([]CommitInfo, error) {
	commits := []CommitInfo{}
	if !hasHead(repo) {
		return commits, nil
	}
	if limit < 1 {
		limit = 1
	}
	if limit > 200 {
		limit = 200
	}
	if skip < 0 {
		skip = 0
	}
	out, err := git(repo, readTimeout, "log", "-n", strconv.Itoa(limit), "--skip="+strconv.Itoa(skip), "--no-color",
		"--pretty=format:%H%x1f%h%x1f%an%x1f%at%x1f%s%x1f%b%x1e")
	if err != nil {
		return nil, err
	}
	for _, rec := range strings.Split(out, "\x1e") {
		rec = strings.Trim(rec, "\r\n")
		if rec == "" {
			continue
		}
		parts := strings.SplitN(rec, "\x1f", 6)
		if len(parts) != 6 {
			continue
		}
		at, _ := strconv.ParseInt(parts[3], 10, 64)
		commits = append(commits, CommitInfo{
			Hash: parts[0], Short: parts[1], Author: parts[2], At: at * 1000, Subject: parts[4],
			Agent: agentFromBody(parts[5]),
		})
	}
	return commits, nil
}

// agentFromBody reads the Orbit-Agent trailer from a commit message body.
func agentFromBody(body string) string {
	for _, line := range strings.Split(body, "\n") {
		key, value, ok := strings.Cut(line, ":")
		if ok && strings.EqualFold(strings.TrimSpace(key), AgentTrailer) {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

// Show returns one commit with its message and the files it changed, with line counts.
func Show(repo, hash string) (CommitDetail, error) {
	if !hexHash.MatchString(hash) {
		return CommitDetail{}, errors.New("that is not a commit")
	}
	out, err := git(repo, readTimeout, "show", "-s", "--no-color", "--pretty=format:%H%x1f%h%x1f%an%x1f%at%x1f%s%x1f%b", hash)
	if err != nil {
		return CommitDetail{}, err
	}
	parts := strings.SplitN(strings.TrimRight(out, "\r\n"), "\x1f", 6)
	if len(parts) != 6 {
		return CommitDetail{}, errors.New("could not read that commit")
	}
	at, _ := strconv.ParseInt(parts[3], 10, 64)
	detail := CommitDetail{
		CommitInfo: CommitInfo{
			Hash: parts[0], Short: parts[1], Author: parts[2], At: at * 1000, Subject: parts[4],
			Agent: agentFromBody(parts[5]),
		},
		Body:  strings.TrimSpace(parts[5]),
		Files: []CommitFile{},
	}

	// Name-status gives each file's kind; numstat gives its line counts. Both use -z, so odd names
	// survive intact.
	names, err := git(repo, readTimeout, "diff-tree", "--root", "--no-commit-id", "-r", "-M", "-z", "--name-status", hash)
	if err != nil {
		return CommitDetail{}, err
	}
	stats, err := git(repo, readTimeout, "diff-tree", "--root", "--no-commit-id", "-r", "-M", "-z", "--numstat", hash)
	if err != nil {
		return CommitDetail{}, err
	}
	detail.Files = parseNameStatus(names, parseNumstat(stats))
	return detail, nil
}

// parseNameStatus reads `diff-tree --name-status -z`: a status token, then one path, or two paths for
// renames and copies. Counts come from parseNumstat, keyed by the path the file has after the commit.
func parseNameStatus(out string, counts map[string][3]int) []CommitFile {
	files := []CommitFile{}
	fields := strings.Split(out, "\x00")
	for i := 0; i+1 < len(fields); i++ {
		status := fields[i]
		if status == "" {
			continue
		}
		f := CommitFile{Status: status[:1]}
		if f.Status == "R" || f.Status == "C" {
			f.OldPath = fields[i+1]
			f.Path = fields[i+2]
			i += 2
		} else {
			f.Path = fields[i+1]
			i++
		}
		if c, ok := counts[f.Path]; ok {
			f.Additions, f.Deletions = c[0], c[1]
			f.Binary = c[2] == 1
		}
		files = append(files, f)
	}
	return files
}

// parseNumstat reads `diff-tree --numstat -z`. Renames put the old path in its own field, so the
// new path is the one keyed. Each value is additions, deletions, and whether the file is binary.
func parseNumstat(out string) map[string][3]int {
	counts := map[string][3]int{}
	fields := strings.Split(out, "\x00")
	for i := 0; i < len(fields); i++ {
		parts := strings.SplitN(fields[i], "\t", 3)
		if len(parts) != 3 {
			continue
		}
		add, del, path := parts[0], parts[1], parts[2]
		if path == "" && i+2 < len(fields) {
			// A rename: the empty third field is followed by old and new paths.
			path = fields[i+2]
			i += 2
		}
		var c [3]int
		if add == "-" || del == "-" {
			c[2] = 1
		} else {
			c[0], _ = strconv.Atoi(add)
			c[1], _ = strconv.Atoi(del)
		}
		counts[path] = c
	}
	return counts
}

// CommitDiff returns the patch for one file in one commit. oldPath is included for renames so git
// pairs the two sides.
func CommitDiff(repo, hash, path, oldPath string) (string, error) {
	if !hexHash.MatchString(hash) {
		return "", errors.New("that is not a commit")
	}
	rel, err := safeRel(repo, path)
	if err != nil {
		return "", err
	}
	args := []string{"diff-tree", "--root", "-p", "-M", "--no-color", "--no-ext-diff", hash, "--"}
	if oldPath != "" {
		oldRel, err := safeRel(repo, oldPath)
		if err != nil {
			return "", err
		}
		args = append(args, oldRel)
	}
	args = append(args, rel)
	out, err := git(repo, readTimeout, args...)
	if err != nil {
		return "", err
	}
	return model.Truncate(out, 200<<10), nil
}
