package model

// ReleaseInfo is the newest published Orbit release, as the update check reports it.
type ReleaseInfo struct {
	Version     string `json:"version"`
	PublishedAt int64  `json:"publishedAt"` // Unix milliseconds
	Notes       string `json:"notes"`
	URL         string `json:"url"`
}
