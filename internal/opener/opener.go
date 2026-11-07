// Package opener opens a file in the system's default application, the way double-clicking it does.
package opener

import (
	"errors"
	"os"
)

// Open starts the default application for path. It does not wait for the application to exit.
func Open(path string) error {
	if _, err := os.Stat(path); err != nil {
		if os.IsNotExist(err) {
			return errors.New("that file no longer exists on disk")
		}
		return err
	}
	return openPath(path)
}
