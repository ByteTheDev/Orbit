package provider

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"orbit/internal/model"
)

// codexModelsForAccount is the Codex model list with UltraFast set on each model the account can run
// in ultrafast mode. The shared list is copied, so the account's answer never changes it.
func codexModelsForAccount() []model.ModelOption {
	out := make([]model.ModelOption, len(codexModels))
	copy(out, codexModels)
	for i := range out {
		if ultraTierLookup(out[i].ID) != "" {
			out[i].UltraFast = true
		}
	}
	return out
}

// The Codex CLI keeps a copy of the model list for the signed-in account in models_cache.json, under
// CODEX_HOME (default ~/.codex). Each model lists the service tiers that account can use. Orbit reads
// that copy rather than calling OpenAI itself, so it sees exactly what the account has.

// codexTierFile is the part of models_cache.json that Orbit reads.
type codexTierFile struct {
	Models []struct {
		Slug         string `json:"slug"`
		ServiceTiers []struct {
			ID   string `json:"id"`
			Name string `json:"name"`
		} `json:"service_tiers"`
	} `json:"models"`
}

var codexTiers struct {
	sync.Mutex
	path  string
	mtime time.Time
	ultra map[string]string // model slug -> id of the account's ultrafast tier
}

// ultraTierLookup finds a model's ultrafast tier id. Tests replace it.
var ultraTierLookup = codexUltraTier

// codexUltraTier returns the ultrafast tier id the account offers for model, or "" when it offers none.
func codexUltraTier(model string) string {
	return codexUltraTiers()[model]
}

// codexUltraTiers returns, per model slug, the id of the account's ultrafast tier. The file is re-read
// only when its modification time changes, because the Codex CLI rewrites it from time to time.
func codexUltraTiers() map[string]string {
	path := codexModelsCachePath()
	if path == "" {
		return nil
	}
	info, err := os.Stat(path)
	if err != nil {
		return nil
	}
	codexTiers.Lock()
	defer codexTiers.Unlock()
	if codexTiers.ultra != nil && codexTiers.path == path && codexTiers.mtime.Equal(info.ModTime()) {
		return codexTiers.ultra
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return nil
	}
	codexTiers.path, codexTiers.mtime = path, info.ModTime()
	codexTiers.ultra = parseCodexUltraTiers(data)
	return codexTiers.ultra
}

// codexModelsCachePath is the cache file under CODEX_HOME, or ~/.codex when that is not set.
func codexModelsCachePath() string {
	home := os.Getenv("CODEX_HOME")
	if home == "" {
		h, err := os.UserHomeDir()
		if err != nil {
			return ""
		}
		home = filepath.Join(h, ".codex")
	}
	return filepath.Join(home, "models_cache.json")
}

// parseCodexUltraTiers reads a models_cache.json body and returns, per model slug, the id of its
// ultrafast service tier. A tier counts as ultrafast when its id or name says "ultra". Anything that
// does not parse gives an empty map, so the account is treated as having no ultrafast.
func parseCodexUltraTiers(data []byte) map[string]string {
	out := map[string]string{}
	var f codexTierFile
	if json.Unmarshal(data, &f) != nil {
		return out
	}
	for _, m := range f.Models {
		for _, t := range m.ServiceTiers {
			if isUltraTier(t.ID, t.Name) {
				out[m.Slug] = t.ID
				break
			}
		}
	}
	return out
}

// isUltraTier reports whether a service tier is the ultrafast one. It needs a non-empty id, because
// the id is what gets sent to the CLI.
func isUltraTier(id, name string) bool {
	return id != "" && strings.Contains(strings.ToLower(id+" "+name), "ultra")
}
