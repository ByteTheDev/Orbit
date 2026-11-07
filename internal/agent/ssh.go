package agent

import (
	"context"
	"errors"
	"sort"

	"orbit/internal/model"
	"orbit/internal/ssh"
)

// ErrSSHProfileNotFound is returned when an SSH profile id no longer exists.
var ErrSSHProfileNotFound = errors.New("that SSH connection no longer exists")

// SSHProfiles returns every saved SSH connection, oldest first.
func (m *Manager) SSHProfiles() []model.SSHProfile {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]model.SSHProfile, 0, len(m.sshProfiles))
	for _, p := range m.sshProfiles {
		out = append(out, *p)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt < out[j].CreatedAt })
	return out
}

// SaveSSHProfile creates a profile when p.ID is empty, and otherwise updates the one with that ID.
func (m *Manager) SaveSSHProfile(p model.SSHProfile) (model.SSHProfile, error) {
	p, err := ssh.Normalize(p)
	if err != nil {
		return model.SSHProfile{}, err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	now := nowMs()
	if p.ID == "" {
		p.ID = newID()
		p.CreatedAt = now
	} else {
		prev, ok := m.sshProfiles[p.ID]
		if !ok {
			return model.SSHProfile{}, ErrSSHProfileNotFound
		}
		p.CreatedAt = prev.CreatedAt
	}
	m.sshProfiles[p.ID] = &p
	m.changedLocked()
	return p, nil
}

// DeleteSSHProfile removes a saved SSH connection.
func (m *Manager) DeleteSSHProfile(id string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.sshProfiles[id]; !ok {
		return ErrSSHProfileNotFound
	}
	delete(m.sshProfiles, id)
	m.changedLocked()
	return nil
}

// TestSSHProfile opens the saved connection and runs a trivial command.
func (m *Manager) TestSSHProfile(ctx context.Context, id string) error {
	m.mu.Lock()
	p, ok := m.sshProfiles[id]
	var prof model.SSHProfile
	if ok {
		prof = *p
	}
	m.mu.Unlock()
	if !ok {
		return ErrSSHProfileNotFound
	}
	return ssh.Test(ctx, prof)
}

// RunSSHCommand runs command on the saved connection and returns its output.
func (m *Manager) RunSSHCommand(ctx context.Context, id, command string) (string, error) {
	m.mu.Lock()
	p, ok := m.sshProfiles[id]
	var prof model.SSHProfile
	if ok {
		prof = *p
	}
	m.mu.Unlock()
	if !ok {
		return "", ErrSSHProfileNotFound
	}
	return ssh.Run(ctx, prof, command)
}
