package model

// Automation launches an agent on a schedule: on the chosen weekdays, at a local time of day.
// It runs only while Orbit is open. A run that was due while Orbit was closed is skipped, not caught up.
type Automation struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	ProjectID string `json:"projectId"`
	// Enabled turns the schedule on. A disabled automation keeps its settings but never fires.
	Enabled bool `json:"enabled"`
	// Days are the weekdays to run on: 0 is Sunday through 6 is Saturday. Kept sorted and without duplicates.
	Days []int `json:"days"`
	// Time is the local time of day, 24-hour "HH:MM".
	Time string `json:"time"`
	// Provider, Model, PermissionMode and Task describe the agent each run launches. An empty model uses the
	// provider's default, and an empty mode uses the provider's first.
	Provider       string `json:"provider"`
	Model          string `json:"model"`
	PermissionMode string `json:"permissionMode"`
	Task           string `json:"task"`
	CreatedAt      int64  `json:"createdAt"`
	// LastRunAt is the scheduled time (Unix ms) of the last slot that was handled, whether it launched or was skipped.
	// Before the first run it is the time the automation was saved, so earlier slots never fire.
	LastRunAt int64 `json:"lastRunAt"`
	// LastError is why the last run could not start its agent. Empty after a successful run.
	LastError string `json:"lastError"`
	// NextRunAt is the next scheduled time (Unix ms). Computed when listed, and 0 when disabled.
	NextRunAt int64 `json:"nextRunAt"`
}
