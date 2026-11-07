//go:build darwin || linux

package terminal

import (
	"os"
	"os/exec"
)

func shell() string {
	if name := os.Getenv("SHELL"); name != "" {
		if path, err := exec.LookPath(name); err == nil {
			return path
		}
	}
	return "/bin/sh"
}
