package files

import (
	"path/filepath"
	"sort"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
)

// maxWatchedDirs bounds how many folders are watched at once. Each one is an OS handle.
const maxWatchedDirs = 256

// watchDebounce merges the burst of events one save or one git command produces.
const watchDebounce = 200 * time.Millisecond

// Change is one batch of filesystem activity in the watched project. Dirs are the folders whose
// contents changed (root-relative, "" for the root). Git is set when HEAD, a branch or the packed
// refs moved, so branch and history views should reload.
type Change struct {
	ProjectID string   `json:"projectId"`
	Dirs      []string `json:"dirs"`
	Git       bool     `json:"git"`
}

// gitMetaFiles are the files in the git folder whose change means the visible state moved. The
// index is deliberately left out: git status rewrites it, which would otherwise loop forever.
var gitMetaFiles = map[string]bool{"HEAD": true, "packed-refs": true, "FETCH_HEAD": true, "ORIG_HEAD": true, "MERGE_HEAD": true}

// Watcher reports changes in one project's folders. It watches the project root, the folders the
// Files sidebar has open, and the git metadata that changes with branches and commits. It does not
// walk the whole tree, so large repositories cost the same as small ones.
type Watcher struct {
	emit func(Change)

	mu        sync.Mutex
	fs        *fsnotify.Watcher
	projectID string
	root      string
	gitDirs   []string
	// dirs maps an absolute watched folder to its root-relative path. gitDirs does the same for git.
	dirs     map[string]string
	gitWatch map[string]bool
	pendDirs map[string]bool
	pendGit  bool
	timer    *time.Timer
	closed   bool
}

// NewWatcher starts a watcher that calls emit with each debounced batch. It runs its own goroutine.
func NewWatcher(emit func(Change)) (*Watcher, error) {
	fw, err := fsnotify.NewWatcher()
	if err != nil {
		return nil, err
	}
	w := &Watcher{
		emit:     emit,
		fs:       fw,
		dirs:     map[string]string{},
		gitWatch: map[string]bool{},
		pendDirs: map[string]bool{},
	}
	go w.loop(fw)
	return w, nil
}

// Set replaces what is watched. dirs are root-relative folders; the root and git metadata are
// always included. Passing a different project or root drops the previous one entirely.
func (w *Watcher) Set(projectID, root string, gitDirs []string, dirs []string) {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.closed {
		return
	}
	if projectID != w.projectID || root != w.root {
		w.dropAllLocked()
		w.projectID, w.root, w.gitDirs = projectID, root, gitDirs
	}
	want := map[string]string{}
	if root != "" {
		want[root] = ""
	}
	for _, rel := range dirs {
		if len(want) >= maxWatchedDirs {
			break
		}
		abs, err := Resolve(root, rel)
		if err != nil {
			continue
		}
		want[abs] = filepath.ToSlash(rel)
	}
	for abs := range w.dirs {
		if _, keep := want[abs]; !keep {
			_ = w.fs.Remove(abs)
			delete(w.dirs, abs)
		}
	}
	for abs, rel := range want {
		if _, have := w.dirs[abs]; !have {
			if err := w.fs.Add(abs); err == nil {
				w.dirs[abs] = rel
			}
		}
	}
	w.watchGitLocked()
}

// watchGitLocked watches each git folder and its refs/heads, where branch and commit moves land.
func (w *Watcher) watchGitLocked() {
	for _, gd := range w.gitDirs {
		for _, p := range []string{gd, filepath.Join(gd, "refs", "heads")} {
			if w.gitWatch[p] {
				continue
			}
			if err := w.fs.Add(p); err == nil {
				w.gitWatch[p] = true
			}
		}
	}
}

// Stop drops every watch and ends the goroutine.
func (w *Watcher) Stop() {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.closed {
		return
	}
	w.closed = true
	w.dropAllLocked()
	if w.timer != nil {
		w.timer.Stop()
	}
	_ = w.fs.Close()
}

func (w *Watcher) dropAllLocked() {
	for abs := range w.dirs {
		_ = w.fs.Remove(abs)
	}
	for p := range w.gitWatch {
		_ = w.fs.Remove(p)
	}
	w.dirs = map[string]string{}
	w.gitWatch = map[string]bool{}
	w.pendDirs = map[string]bool{}
	w.pendGit = false
	if w.timer != nil {
		w.timer.Stop()
		w.timer = nil
	}
}

func (w *Watcher) loop(fw *fsnotify.Watcher) {
	for {
		select {
		case ev, ok := <-fw.Events:
			if !ok {
				return
			}
			w.record(ev)
		case _, ok := <-fw.Errors:
			if !ok {
				return
			}
			// A folder that was deleted or a watch the OS dropped. The next Set repairs it.
		}
	}
}

// record files one event under the folder it happened in, then schedules a flush.
func (w *Watcher) record(ev fsnotify.Event) {
	if ev.Op == fsnotify.Chmod {
		return
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.closed {
		return
	}
	dir := filepath.Dir(ev.Name)
	hit := false
	for _, gd := range w.gitDirs {
		if dir == filepath.Join(gd, "refs", "heads") || (dir == gd && gitMetaFiles[filepath.Base(ev.Name)]) {
			w.pendGit = true
			hit = true
		}
	}
	if rel, ok := w.dirs[dir]; ok {
		w.pendDirs[rel] = true
		hit = true
	}
	if !hit {
		return
	}
	if w.timer == nil {
		w.timer = time.AfterFunc(watchDebounce, w.flush)
	} else {
		w.timer.Reset(watchDebounce)
	}
}

func (w *Watcher) flush() {
	w.mu.Lock()
	if w.closed || (len(w.pendDirs) == 0 && !w.pendGit) {
		w.timer = nil
		w.mu.Unlock()
		return
	}
	dirs := make([]string, 0, len(w.pendDirs))
	for d := range w.pendDirs {
		dirs = append(dirs, d)
	}
	sort.Strings(dirs)
	change := Change{ProjectID: w.projectID, Dirs: dirs, Git: w.pendGit}
	w.pendDirs = map[string]bool{}
	w.pendGit = false
	w.timer = nil
	w.mu.Unlock()
	w.emit(change)
}
