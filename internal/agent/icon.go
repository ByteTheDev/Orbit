package agent

import (
	"bytes"
	"encoding/base64"
	"errors"
	"fmt"
	"image/png"
	"os"
	"path/filepath"

	"orbit/internal/model"
)

// SetIconDir sets the folder where uploaded project icons are stored. Call it once at
// startup, before any upload. Icons live beside the state file, one PNG per project.
func (m *Manager) SetIconDir(dir string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.iconDir = dir
}

// SetProjectIconImage makes data (a PNG file) the project's icon, replacing any letter.
// The file is fully decoded before it is stored, so a corrupt or oversized image is
// rejected here rather than shown as a broken sun.
func (m *Manager) SetProjectIconImage(id string, data []byte) error {
	if len(data) == 0 {
		return errors.New("choose a PNG image")
	}
	if len(data) > model.MaxIconBytes {
		return fmt.Errorf("the icon must be smaller than %d MB", model.MaxIconBytes>>20)
	}
	cfg, err := png.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		return errors.New("the icon must be a PNG image")
	}
	if cfg.Width > model.MaxIconPixels || cfg.Height > model.MaxIconPixels {
		return fmt.Errorf("the icon can be at most %d×%d pixels", model.MaxIconPixels, model.MaxIconPixels)
	}
	if _, err := png.Decode(bytes.NewReader(data)); err != nil {
		return errors.New("the PNG file is damaged")
	}

	m.mu.Lock()
	dir := m.iconDir
	_, ok := m.projects[id]
	m.mu.Unlock()
	if !ok {
		return errors.New("that project no longer exists")
	}
	if dir == "" {
		return errors.New("icon storage is not ready")
	}
	if err := writeFileAtomic(iconPath(dir, id), data); err != nil {
		return err
	}

	m.mu.Lock()
	defer m.mu.Unlock()
	p, ok := m.projects[id]
	if !ok {
		// Deleted while the file was being written: do not leave an orphan behind.
		_ = os.Remove(iconPath(dir, id))
		return errors.New("that project no longer exists")
	}
	p.Icon = ""
	p.IconRev = max(nowMs(), p.IconRev+1)
	m.dirtyProjects[id] = true
	m.scheduleFlushLocked()
	m.changedLocked()
	return nil
}

// ProjectIconImage returns the project's uploaded icon as a PNG data URL, or "" when it
// has none. The data URL lets the webview draw it without a file server.
func (m *Manager) ProjectIconImage(id string) (string, error) {
	m.mu.Lock()
	p, ok := m.projects[id]
	var rev int64
	if ok {
		rev = p.IconRev
	}
	dir := m.iconDir
	m.mu.Unlock()
	if !ok {
		return "", errors.New("that project no longer exists")
	}
	if rev == 0 {
		return "", nil
	}
	data, err := os.ReadFile(iconPath(dir, id))
	if err != nil {
		return "", fmt.Errorf("read icon: %w", err)
	}
	return "data:image/png;base64," + base64.StdEncoding.EncodeToString(data), nil
}

// clearIconLocked removes a project's uploaded icon, if it has one. Caller holds m.mu.
func (m *Manager) clearIconLocked(p *model.Project) {
	if p.IconRev == 0 {
		return
	}
	p.IconRev = 0
	if m.iconDir != "" {
		_ = os.Remove(iconPath(m.iconDir, p.ID))
	}
}

// iconPath is the storage path for a project's icon. Base strips any path parts, so an id
// can never point outside the icon folder.
func iconPath(dir, id string) string {
	return filepath.Join(dir, filepath.Base(id)+".png")
}

func writeFileAtomic(path string, data []byte) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return fmt.Errorf("create icon folder: %w", err)
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return fmt.Errorf("write icon: %w", err)
	}
	if err := os.Rename(tmp, path); err != nil {
		return fmt.Errorf("save icon: %w", err)
	}
	return nil
}
