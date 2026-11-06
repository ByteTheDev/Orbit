// Package conflict finds files that more than one agent has written in the same project.
package conflict

import (
	"sort"

	"orbit/internal/model"
)

// AgentWrites is one agent's write counts keyed by file path.
type AgentWrites struct {
	ID     string
	Name   string
	Writes map[string]int
}

// Detect returns every path written by two or more agents, sorted by path.
// Agents are listed in the order given, so callers can pass a stable order.
func Detect(agents []AgentWrites) []model.Conflict {
	byPath := map[string][]model.ConflictAgent{}
	for _, a := range agents {
		for path, n := range a.Writes {
			if n > 0 {
				byPath[path] = append(byPath[path], model.ConflictAgent{ID: a.ID, Name: a.Name})
			}
		}
	}
	out := make([]model.Conflict, 0)
	for path, list := range byPath {
		if len(list) < 2 {
			continue
		}
		out = append(out, model.Conflict{Path: path, Agents: list})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Path < out[j].Path })
	return out
}
