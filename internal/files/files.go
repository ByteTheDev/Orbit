// Package files reads and changes the files of a project folder for the Files sidebar. Every path
// is relative to the project root and must stay inside it. Git's .gitignore rules decide what is
// listed, so build output and dependency folders stay out of the tree.
package files

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"orbit/internal/gitdiff"
	"orbit/internal/opener"
)

const (
	// MaxDirEntries caps one folder listing. A folder with more entries is cut short and marked.
	MaxDirEntries = 2000
	// MaxTextBytes is the largest file the editor opens. Bigger files are shown as too large.
	MaxTextBytes = 1 << 20
	// maxFindResults caps a name search. The UI shows the best matches, not every match.
	maxFindResults = 200
	// maxWalkFiles bounds the walk used for folders that are not git repositories.
	maxWalkFiles = 100_000
	findCacheTTL = 4 * time.Second
)

// ErrConflict is returned when a file changed on disk after the editor loaded it.
var ErrConflict = errors.New("this file changed on disk after it was opened, so saving would overwrite those changes. Reopen it to see the latest version")

// Entry is one file or folder in a listing.
type Entry struct {
	Name    string `json:"name"`
	Path    string `json:"path"` // relative to the project root, slash separated
	IsDir   bool   `json:"isDir"`
	Link    bool   `json:"link,omitempty"`
	Size    int64  `json:"size"`
	ModTime int64  `json:"modTime"` // unix milliseconds
}

// Listing is the content of one folder.
type Listing struct {
	Entries   []Entry `json:"entries"`
	Truncated bool    `json:"truncated"`
}

// Text is a file's content for the editor. Binary and oversized files come back without content.
type Text struct {
	Path     string `json:"path"`
	Content  string `json:"content"`
	Size     int64  `json:"size"`
	ModTime  int64  `json:"modTime"`
	Binary   bool   `json:"binary"`
	TooLarge bool   `json:"tooLarge"`
}

// Resolve turns a root-relative path into an absolute one inside root. It rejects absolute
// paths, ".." escapes, and any path that leads through a symbolic link out of the root.
func Resolve(root, rel string) (string, error) {
	if strings.ContainsRune(rel, 0) {
		return "", errors.New("that path is not valid")
	}
	if filepath.IsAbs(rel) || filepath.VolumeName(rel) != "" || strings.HasPrefix(rel, "/") || strings.HasPrefix(rel, `\`) {
		return "", errors.New("paths must be relative to the project folder")
	}
	abs := filepath.Join(root, filepath.FromSlash(rel))
	if !within(root, abs) {
		return "", errors.New("that path is outside the project folder")
	}
	return abs, nil
}

// within reports whether path is root or inside it, lexically.
func within(root, path string) bool {
	r, err := filepath.Rel(root, path)
	if err != nil {
		return false
	}
	return r == "." || (r != ".." && !strings.HasPrefix(r, ".."+string(filepath.Separator)) && !filepath.IsAbs(r))
}

// resolveReal is Resolve plus a check that symbolic links do not lead out of the root.
func resolveReal(root, rel string) (string, error) {
	abs, err := Resolve(root, rel)
	if err != nil {
		return "", err
	}
	realRoot, err := filepath.EvalSymlinks(root)
	if err != nil {
		return "", err
	}
	real, err := filepath.EvalSymlinks(abs)
	if err != nil {
		return "", err
	}
	if !within(realRoot, real) {
		return "", errors.New("that file is a link to somewhere outside the project folder")
	}
	return abs, nil
}

// isGitPath reports whether rel is inside a .git folder, which Orbit never reads or writes.
func isGitPath(rel string) bool {
	for _, part := range strings.Split(filepath.ToSlash(rel), "/") {
		if strings.EqualFold(part, ".git") {
			return true
		}
	}
	return false
}

// List returns the visible entries of one folder: folders first, then files, each sorted by name.
// Git-ignored entries and the .git folder are left out. rel "" is the project root.
func List(root, rel string) (Listing, error) {
	dir, err := Resolve(root, rel)
	if err != nil {
		return Listing{}, err
	}
	info, err := os.Stat(dir)
	if err != nil {
		return Listing{}, err
	}
	if !info.IsDir() {
		return Listing{}, errors.New("that is not a folder")
	}
	dirents, err := os.ReadDir(dir)
	if err != nil {
		return Listing{}, err
	}
	listing := Listing{Entries: make([]Entry, 0, len(dirents))}
	prefix := filepath.ToSlash(filepath.Clean(rel))
	if prefix == "." {
		prefix = ""
	}

	candidates := make([]Entry, 0, len(dirents))
	for _, d := range dirents {
		if strings.EqualFold(d.Name(), ".git") {
			continue
		}
		e := Entry{Name: d.Name(), Path: join(prefix, d.Name())}
		fi, err := d.Info()
		if err != nil {
			continue // vanished between the listing and the stat
		}
		e.ModTime = fi.ModTime().UnixMilli()
		switch {
		case fi.Mode()&fs.ModeSymlink != 0:
			e.Link = true
		case fi.IsDir():
			e.IsDir = true
		default:
			e.Size = fi.Size()
		}
		candidates = append(candidates, e)
	}

	// Ask git which of the candidates are ignored, in one call. Outside a repository, nothing is.
	checks := make([]string, len(candidates))
	for i, e := range candidates {
		checks[i] = e.Path
		if e.IsDir {
			checks[i] += "/"
		}
	}
	ignored, err := gitdiff.IgnoredPaths(root, checks)
	if err != nil && !errors.Is(err, gitdiff.ErrNotGit) {
		return Listing{}, err
	}
	for i, e := range candidates {
		if ignored[checks[i]] {
			continue
		}
		listing.Entries = append(listing.Entries, e)
	}

	sort.SliceStable(listing.Entries, func(i, j int) bool {
		a, b := listing.Entries[i], listing.Entries[j]
		if a.IsDir != b.IsDir {
			return a.IsDir
		}
		return strings.ToLower(a.Name) < strings.ToLower(b.Name)
	})
	if len(listing.Entries) > MaxDirEntries {
		listing.Entries = listing.Entries[:MaxDirEntries]
		listing.Truncated = true
	}
	return listing, nil
}

func join(prefix, name string) string {
	if prefix == "" {
		return name
	}
	return prefix + "/" + name
}

var (
	findMu    sync.Mutex
	findCache = map[string]findEntry{}
)

type findEntry struct {
	at    time.Time
	paths []string
}

// Find returns up to maxFindResults file paths whose name or path contains query, ignoring case.
// Names that start with the query rank first, then shorter paths. The file list comes from git,
// which already applies .gitignore, so a search never walks node_modules or build output.
func Find(root, query string) (Matches, error) {
	q := strings.ToLower(strings.TrimSpace(query))
	if q == "" {
		return Matches{Entries: []Entry{}}, nil
	}
	paths, err := candidatePaths(root)
	if err != nil {
		return Matches{}, err
	}
	type hit struct {
		path  string
		score int
	}
	var hits []hit
	for _, p := range paths {
		lower := strings.ToLower(p)
		name := lower[strings.LastIndex(lower, "/")+1:]
		switch {
		case strings.HasPrefix(name, q):
			hits = append(hits, hit{p, 0})
		case strings.Contains(name, q):
			hits = append(hits, hit{p, 1})
		case strings.Contains(lower, q):
			hits = append(hits, hit{p, 2})
		}
	}
	sort.SliceStable(hits, func(i, j int) bool {
		if hits[i].score != hits[j].score {
			return hits[i].score < hits[j].score
		}
		if len(hits[i].path) != len(hits[j].path) {
			return len(hits[i].path) < len(hits[j].path)
		}
		return hits[i].path < hits[j].path
	})
	truncated := len(hits) > maxFindResults
	if truncated {
		hits = hits[:maxFindResults]
	}
	out := make([]Entry, 0, len(hits))
	for _, h := range hits {
		out = append(out, Entry{Name: h.path[strings.LastIndex(h.path, "/")+1:], Path: h.path})
	}
	return Matches{Entries: out, Truncated: truncated}, nil
}

// Matches is the result of a name search.
type Matches struct {
	Entries   []Entry `json:"entries"`
	Truncated bool    `json:"truncated"`
}

// candidatePaths lists the project's files. Repositories use git's view; anything else is walked,
// skipping well-known dependency folders, up to a limit.
func candidatePaths(root string) ([]string, error) {
	findMu.Lock()
	cached, ok := findCache[root]
	findMu.Unlock()
	if ok && time.Since(cached.at) < findCacheTTL {
		return cached.paths, nil
	}
	paths, err := gitdiff.ListFiles(root)
	if errors.Is(err, gitdiff.ErrNotGit) {
		paths, err = walkFiles(root)
	}
	if err != nil {
		return nil, err
	}
	findMu.Lock()
	findCache[root] = findEntry{at: time.Now(), paths: paths}
	findMu.Unlock()
	return paths, nil
}

var walkSkip = map[string]bool{".git": true, "node_modules": true, "vendor": true, "__pycache__": true, ".venv": true}

func walkFiles(root string) ([]string, error) {
	var out []string
	err := filepath.WalkDir(root, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil // unreadable folders are skipped, not fatal
		}
		if d.IsDir() {
			if p != root && walkSkip[d.Name()] {
				return filepath.SkipDir
			}
			return nil
		}
		if d.Type()&fs.ModeSymlink != 0 {
			return nil
		}
		rel, err := filepath.Rel(root, p)
		if err != nil {
			return nil
		}
		out = append(out, filepath.ToSlash(rel))
		if len(out) >= maxWalkFiles {
			return fs.SkipAll
		}
		return nil
	})
	return out, err
}

// ValidName reports whether name can be used for a file or folder on Windows and elsewhere:
// no separators or reserved characters, no reserved device names, no trailing dot or space.
func ValidName(name string) error {
	n := strings.TrimSpace(name)
	switch {
	case n == "":
		return errors.New("name the file or folder")
	case n != name:
		return errors.New("names cannot start or end with a space")
	case name == "." || name == "..":
		return errors.New("that name is reserved")
	case strings.ContainsAny(name, `<>:"/\|?*`) || strings.ContainsFunc(name, func(r rune) bool { return r < 32 }):
		return errors.New(`names cannot contain any of these characters: < > : " / \ | ? *`)
	case strings.HasSuffix(name, "."):
		return errors.New("names cannot end with a dot")
	case len(name) > 255:
		return errors.New("that name is too long")
	}
	base := strings.ToUpper(name)
	if i := strings.IndexByte(base, '.'); i >= 0 {
		base = base[:i]
	}
	if reservedNames[base] {
		return fmt.Errorf("%q is a reserved name on Windows", name)
	}
	return nil
}

var reservedNames = map[string]bool{
	"CON": true, "PRN": true, "AUX": true, "NUL": true,
	"COM1": true, "COM2": true, "COM3": true, "COM4": true, "COM5": true, "COM6": true, "COM7": true, "COM8": true, "COM9": true,
	"LPT1": true, "LPT2": true, "LPT3": true, "LPT4": true, "LPT5": true, "LPT6": true, "LPT7": true, "LPT8": true, "LPT9": true,
}

// Create makes an empty file, or a folder when isDir is set, inside the folder dir. It returns the
// new path relative to the root. An existing name is an error, never an overwrite.
func Create(root, dir, name string, isDir bool) (string, error) {
	if err := ValidName(name); err != nil {
		return "", err
	}
	parent, err := resolveReal(root, dir)
	if err != nil {
		return "", err
	}
	rel := join(cleanRel(dir), name)
	if isGitPath(rel) {
		return "", errors.New("the .git folder is managed by git")
	}
	target := filepath.Join(parent, name)
	if isDir {
		if err := os.Mkdir(target, 0o755); err != nil {
			return "", describe(err)
		}
		return rel, nil
	}
	f, err := os.OpenFile(target, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o644)
	if err != nil {
		return "", describe(err)
	}
	return rel, f.Close()
}

// Rename changes the name of rel to newName, in the same folder. Changing only the case of a name
// is allowed. It returns the new path relative to the root.
func Rename(root, rel, newName string) (string, error) {
	if err := ValidName(newName); err != nil {
		return "", err
	}
	if isGitPath(rel) || rel == "" {
		return "", errors.New("this item cannot be renamed")
	}
	src, err := resolveReal(root, rel)
	if err != nil {
		return "", err
	}
	if _, err := os.Lstat(src); err != nil {
		return "", describe(err)
	}
	dst := filepath.Join(filepath.Dir(src), newName)
	if !within(root, dst) {
		return "", errors.New("that path is outside the project folder")
	}
	if _, err := os.Lstat(dst); err == nil && !sameFile(src, dst) {
		return "", fmt.Errorf("%q already exists here", newName)
	}
	if err := os.Rename(src, dst); err != nil {
		return "", describe(err)
	}
	parent := filepath.ToSlash(filepath.Dir(filepath.FromSlash(rel)))
	if parent == "." {
		parent = ""
	}
	return join(parent, newName), nil
}

// sameFile reports whether a and b are the same entry, which happens when only the case changed.
func sameFile(a, b string) bool {
	ai, err1 := os.Stat(a)
	bi, err2 := os.Stat(b)
	return err1 == nil && err2 == nil && os.SameFile(ai, bi)
}

// Delete removes files and folders (folders with everything in them). Symbolic links are removed
// themselves, never what they point to. The project root and the .git folder cannot be removed.
func Delete(root string, rels []string) error {
	var firstErr error
	for _, rel := range rels {
		if rel == "" || isGitPath(rel) {
			return errors.New("this item cannot be deleted from Orbit")
		}
		abs, err := Resolve(root, rel)
		if err != nil {
			return err
		}
		if err := os.RemoveAll(abs); err != nil && firstErr == nil {
			firstErr = describe(err)
		}
	}
	return firstErr
}

// ReadText loads a file for the editor. Binary and oversized files report that instead of content.
func ReadText(root, rel string) (Text, error) {
	if isGitPath(rel) {
		return Text{}, errors.New("the .git folder is not shown in the editor")
	}
	abs, err := resolveReal(root, rel)
	if err != nil {
		return Text{}, err
	}
	fi, err := os.Stat(abs)
	if err != nil {
		return Text{}, describe(err)
	}
	if fi.IsDir() {
		return Text{}, errors.New("that is a folder")
	}
	t := Text{Path: rel, Size: fi.Size(), ModTime: fi.ModTime().UnixMilli()}
	if fi.Size() > MaxTextBytes {
		t.TooLarge = true
		return t, nil
	}
	data, err := os.ReadFile(abs)
	if err != nil {
		return Text{}, describe(err)
	}
	head := data
	if len(head) > 8000 {
		head = head[:8000]
	}
	if bytes.IndexByte(head, 0) >= 0 {
		t.Binary = true
		return t, nil
	}
	t.Content = string(data)
	return t, nil
}

// WriteText saves content over rel. expectedModTime is the modification time the editor loaded;
// when the file has changed since, nothing is written and ErrConflict is returned. The returned
// value is the new modification time.
func WriteText(root, rel, content string, expectedModTime int64) (int64, error) {
	if isGitPath(rel) {
		return 0, errors.New("the .git folder cannot be edited from Orbit")
	}
	abs, err := resolveReal(root, rel)
	if err != nil {
		return 0, err
	}
	fi, err := os.Stat(abs)
	if err != nil {
		return 0, describe(err)
	}
	if fi.ModTime().UnixMilli() != expectedModTime {
		return 0, ErrConflict
	}
	if int64(len(content)) > MaxTextBytes*4 {
		return 0, errors.New("that text is too large to save from Orbit")
	}
	// Write beside the file and rename over it, so a failed write never leaves half a file.
	tmp, err := os.CreateTemp(filepath.Dir(abs), ".orbit-save-*")
	if err != nil {
		return 0, describe(err)
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName)
	if _, err := io.WriteString(tmp, content); err != nil {
		tmp.Close()
		return 0, describe(err)
	}
	if err := tmp.Close(); err != nil {
		return 0, describe(err)
	}
	if err := os.Chmod(tmpName, fi.Mode().Perm()); err != nil {
		return 0, describe(err)
	}
	if err := os.Rename(tmpName, abs); err != nil {
		return 0, describe(err)
	}
	after, err := os.Stat(abs)
	if err != nil {
		return 0, describe(err)
	}
	return after.ModTime().UnixMilli(), nil
}

// Exists reports whether rel is a real entry inside root. Used to drop stale watch and reveal targets.
func Exists(root, rel string) bool {
	abs, err := Resolve(root, rel)
	if err != nil {
		return false
	}
	_, err = os.Lstat(abs)
	return err == nil
}

// Open opens a file or folder in the system's default application.
func Open(root, rel string) error {
	abs, err := resolveReal(root, rel)
	if err != nil {
		return err
	}
	return opener.Open(abs)
}

// Reveal shows a file or folder selected in the system file manager.
func Reveal(root, rel string) error {
	abs, err := resolveReal(root, rel)
	if err != nil {
		return err
	}
	return revealPath(abs)
}

// describe turns OS errors into short sentences, keeping the path out of the message.
func describe(err error) error {
	switch {
	case err == nil:
		return nil
	case errors.Is(err, fs.ErrNotExist):
		return errors.New("that file or folder no longer exists")
	case errors.Is(err, fs.ErrExist):
		return errors.New("that name is already taken")
	case errors.Is(err, fs.ErrPermission):
		return errors.New("Windows will not let Orbit change that. It may be open in another program, or locked")
	}
	return err
}

func cleanRel(rel string) string {
	if rel == "" {
		return ""
	}
	c := filepath.ToSlash(filepath.Clean(rel))
	if c == "." {
		return ""
	}
	return c
}
