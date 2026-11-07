//go:build !windows

package files

import (
	"path/filepath"

	"orbit/internal/opener"
)

// revealPath opens the containing folder, since most file managers have no select flag.
func revealPath(path string) error {
	return opener.Open(filepath.Dir(path))
}
