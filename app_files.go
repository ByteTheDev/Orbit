package main

import (
	"log"

	"orbit/internal/files"
	"orbit/internal/gitdiff"
)

// projectFilesEvent carries a debounced batch of filesystem and git-metadata changes for the
// project the sidebar is showing. The frontend reloads only the folders it names.
const projectFilesEvent = "project:files"

// startWatcher creates the file watcher. Without it the sidebar still works; it just reloads when the
// user acts instead of when files change on disk.
func (a *App) startWatcher() {
	w, err := files.NewWatcher(a.emitFileChange)
	if err != nil {
		log.Printf("orbit: file watching is off: %v", err)
		return
	}
	a.watcher = w
}

func (a *App) emitFileChange(c files.Change) {
	if a.ctx == nil || a.wails == nil {
		return
	}
	a.wails.Event.Emit(projectFilesEvent, c)
}

// projectRoot returns the folder a project's files live in.
func (a *App) projectRoot(projectID string) (string, error) {
	return a.mgr.ProjectRepo(projectID)
}

// ---- Files sidebar -----------------------------------------------------------

// ListProjectDirectory returns the visible entries of one folder of a project. rel "" is the root.
func (a *App) ListProjectDirectory(projectID, rel string) (files.Listing, error) {
	root, err := a.projectRoot(projectID)
	if err != nil {
		return files.Listing{}, err
	}
	return files.List(root, rel)
}

// FindProjectFiles searches the project's file names. Git's ignore rules apply.
func (a *App) FindProjectFiles(projectID, query string) (files.Matches, error) {
	root, err := a.projectRoot(projectID)
	if err != nil {
		return files.Matches{}, err
	}
	return files.Find(root, query)
}

// CreateProjectEntry makes a file or folder inside dir and returns its path.
func (a *App) CreateProjectEntry(projectID, dir, name string, isDir bool) (string, error) {
	root, err := a.projectRoot(projectID)
	if err != nil {
		return "", err
	}
	return files.Create(root, dir, name, isDir)
}

// RenameProjectEntry renames a file or folder and returns its new path.
func (a *App) RenameProjectEntry(projectID, rel, newName string) (string, error) {
	root, err := a.projectRoot(projectID)
	if err != nil {
		return "", err
	}
	return files.Rename(root, rel, newName)
}

// DeleteProjectEntries deletes files and folders. The caller has already confirmed with the user.
func (a *App) DeleteProjectEntries(projectID string, rels []string) error {
	root, err := a.projectRoot(projectID)
	if err != nil {
		return err
	}
	return files.Delete(root, rels)
}

// ReadProjectText loads a file for the editor.
func (a *App) ReadProjectText(projectID, rel string) (files.Text, error) {
	root, err := a.projectRoot(projectID)
	if err != nil {
		return files.Text{}, err
	}
	return files.ReadText(root, rel)
}

// WriteProjectText saves an edited file. It refuses when the file changed since expectedModTime.
// It returns the file's new modification time.
func (a *App) WriteProjectText(projectID, rel, content string, expectedModTime int64) (int64, error) {
	root, err := a.projectRoot(projectID)
	if err != nil {
		return 0, err
	}
	return files.WriteText(root, rel, content, expectedModTime)
}

// OpenProjectEntry opens a file or folder in the system's default application.
func (a *App) OpenProjectEntry(projectID, rel string) error {
	root, err := a.projectRoot(projectID)
	if err != nil {
		return err
	}
	return files.Open(root, rel)
}

// RevealProjectEntry selects a file or folder in the system file manager.
func (a *App) RevealProjectEntry(projectID, rel string) error {
	root, err := a.projectRoot(projectID)
	if err != nil {
		return err
	}
	return files.Reveal(root, rel)
}

// WatchProjectFiles sets what the watcher reports: the project root, the folders the sidebar has
// open, and the project's git metadata. Passing an empty project id stops all watching.
func (a *App) WatchProjectFiles(projectID string, dirs []string) error {
	if a.watcher == nil {
		return nil
	}
	if projectID == "" {
		a.watcher.Set("", "", nil, nil)
		return nil
	}
	root, err := a.projectRoot(projectID)
	if err != nil {
		return err
	}
	gitDirs, err := gitdiff.GitDirs(root)
	if err != nil {
		// Not a repository: watch the folders only.
		gitDirs = nil
	}
	a.watcher.Set(projectID, root, gitDirs, dirs)
	return nil
}

// ---- Git sidebar -------------------------------------------------------------

// GetGitHistory returns a page of commits, skip commits back from HEAD.
func (a *App) GetGitHistory(projectID string, skip, limit int) ([]gitdiff.CommitInfo, error) {
	repo, err := a.projectRoot(projectID)
	if err != nil {
		return nil, err
	}
	return gitdiff.LogPage(repo, skip, limit)
}

// GetGitCommit returns one commit with the files it changed.
func (a *App) GetGitCommit(projectID, hash string) (gitdiff.CommitDetail, error) {
	repo, err := a.projectRoot(projectID)
	if err != nil {
		return gitdiff.CommitDetail{}, err
	}
	return gitdiff.Show(repo, hash)
}

// GetGitCommitDiff returns the patch for one file in one commit.
func (a *App) GetGitCommitDiff(projectID, hash, path, oldPath string) (string, error) {
	repo, err := a.projectRoot(projectID)
	if err != nil {
		return "", err
	}
	return gitdiff.CommitDiff(repo, hash, path, oldPath)
}

// GitFetch downloads the remote's changes without touching the working tree.
func (a *App) GitFetch(projectID string) (string, error) {
	repo, err := a.projectRoot(projectID)
	if err != nil {
		return "", err
	}
	return gitdiff.Fetch(repo)
}

// GitPull brings the current branch up to date with its upstream.
func (a *App) GitPull(projectID string) (string, error) {
	repo, err := a.projectRoot(projectID)
	if err != nil {
		return "", err
	}
	return gitdiff.Pull(repo)
}

// GitPush sends the current branch to its remote.
func (a *App) GitPush(projectID string) (string, error) {
	repo, err := a.projectRoot(projectID)
	if err != nil {
		return "", err
	}
	return gitdiff.Push(repo)
}

// GitSwitchBranch checks out an existing branch.
func (a *App) GitSwitchBranch(projectID, name string) error {
	repo, err := a.projectRoot(projectID)
	if err != nil {
		return err
	}
	return gitdiff.SwitchBranch(repo, name)
}

// GitCreateBranch makes a branch from HEAD and switches to it.
func (a *App) GitCreateBranch(projectID, name string) error {
	repo, err := a.projectRoot(projectID)
	if err != nil {
		return err
	}
	return gitdiff.CreateBranch(repo, name)
}

// GitDiscardChanges throws away the given uncommitted changes. The caller has already confirmed.
func (a *App) GitDiscardChanges(projectID string, targets []gitdiff.DiscardTarget) error {
	repo, err := a.projectRoot(projectID)
	if err != nil {
		return err
	}
	return gitdiff.Discard(repo, targets)
}
