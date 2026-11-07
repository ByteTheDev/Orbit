// Package release finds the newest published Orbit release on GitHub.
package release

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"orbit/internal/model"
)

// Version is this build's version. The Release panel compares it with the latest release,
// and a test keeps the frontend copy in step.
const Version = "1.0.1"

const repo = "ByteTheDev/Orbit"

// apiBase is a variable so tests can point the lookup at a local server.
var apiBase = "https://api.github.com"

// ErrNoRelease means the repository has no published release yet.
var ErrNoRelease = errors.New("no published release yet")

// Latest asks GitHub for the newest published release. Drafts and pre-releases are never returned.
func Latest(ctx context.Context, client *http.Client) (model.ReleaseInfo, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, apiBase+"/repos/"+repo+"/releases/latest", nil)
	if err != nil {
		return model.ReleaseInfo{}, err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "Orbit/"+Version)
	resp, err := client.Do(req)
	if err != nil {
		return model.ReleaseInfo{}, fmt.Errorf("could not reach GitHub: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusNotFound {
		return model.ReleaseInfo{}, ErrNoRelease
	}
	if resp.StatusCode != http.StatusOK {
		return model.ReleaseInfo{}, fmt.Errorf("GitHub answered %s", resp.Status)
	}
	var body struct {
		TagName     string    `json:"tag_name"`
		Body        string    `json:"body"`
		HTMLURL     string    `json:"html_url"`
		PublishedAt time.Time `json:"published_at"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&body); err != nil {
		return model.ReleaseInfo{}, fmt.Errorf("could not read the release: %w", err)
	}
	if body.TagName == "" {
		return model.ReleaseInfo{}, errors.New("the release has no version tag")
	}
	return model.ReleaseInfo{
		Version:     strings.TrimPrefix(body.TagName, "v"),
		PublishedAt: body.PublishedAt.UnixMilli(),
		Notes:       body.Body,
		URL:         body.HTMLURL,
	}, nil
}
