package agent

import (
	"sort"

	"orbit/internal/model"
)

// FileTimeline returns every recorded read and write of path by any agent in the same project
// as agentID, newest first. Each agent keeps only its most recent operations per file, so an
// old event can be missing from a long-running session.
func (m *Manager) FileTimeline(agentID, path string) ([]model.FileEvent, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	rec, ok := m.agents[agentID]
	if !ok {
		return nil, ErrNotFound
	}
	events := []model.FileEvent{}
	for _, other := range m.agents {
		if other.ProjectID != rec.ProjectID {
			continue
		}
		f := other.Files[path]
		if f == nil {
			continue
		}
		for _, op := range f.Ops {
			events = append(events, model.FileEvent{
				AgentID:   other.ID,
				AgentName: other.Name,
				Op:        op.Op,
				Tool:      op.Tool,
				At:        op.At,
			})
		}
	}
	sort.SliceStable(events, func(i, j int) bool { return events[i].At > events[j].At })
	if len(events) > model.MaxFileEvents {
		events = events[:model.MaxFileEvents]
	}
	return events, nil
}
