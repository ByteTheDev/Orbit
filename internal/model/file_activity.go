package model

// FileEvent is one recorded read or write of a file by an agent in the same project.
// Events come from the agents' own tool calls, so a provider that does not report file
// tools leaves its agents out of the timeline.
type FileEvent struct {
	AgentID   string `json:"agentId"`
	AgentName string `json:"agentName"`
	Op        string `json:"op"` // read | write
	Tool      string `json:"tool"`
	At        int64  `json:"at"` // unix milliseconds
}

// MaxFileEvents caps the cross-agent timeline for one file. The newest events are kept.
const MaxFileEvents = 300
