// Package store persists Orbit's projects and agents as one JSON file in the
// user's config directory. Writes are atomic (temp file + rename).
package store

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"

	"orbit/internal/model"
)

// Version is the on-disk schema version.
const Version = 1

// State is the whole persisted document.
type State struct {
	Version  int                 `json:"version"`
	Projects []model.Project     `json:"projects"`
	Agents   []model.AgentRecord `json:"agents"`
	// Automations are optional: a state file from before they existed loads with none.
	Automations []model.Automation `json:"automations,omitempty"`
	// SSHProfiles are optional: a state file from before they existed loads with none.
	SSHProfiles []model.SSHProfile `json:"sshProfiles,omitempty"`
}

// DefaultPath returns <UserConfigDir>/Orbit/state.json.
func DefaultPath() (string, error) {
	dir, err := os.UserConfigDir()
	if err != nil {
		return "", fmt.Errorf("locate config directory: %w", err)
	}
	return filepath.Join(dir, "Orbit", "state.json"), nil
}

// Load reads the state file. A missing file is not an error and yields an empty state.
func Load(path string) (State, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return State{Version: Version}, nil
		}
		return State{}, fmt.Errorf("read state: %w", err)
	}
	var st State
	if err := json.Unmarshal(data, &st); err != nil {
		// Keep the unreadable file for inspection rather than silently discarding it.
		_ = os.Rename(path, path+".corrupt")
		return State{Version: Version}, fmt.Errorf("state file was unreadable and was moved aside: %w", err)
	}
	st.Version = Version
	return st, nil
}

// Save writes the state atomically.
func Save(path string, st State) error {
	st.Version = Version
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return fmt.Errorf("create state directory: %w", err)
	}
	data, err := json.MarshalIndent(st, "", "  ")
	if err != nil {
		return fmt.Errorf("encode state: %w", err)
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return fmt.Errorf("write state: %w", err)
	}
	if err := os.Rename(tmp, path); err != nil {
		return fmt.Errorf("replace state: %w", err)
	}
	return nil
}
