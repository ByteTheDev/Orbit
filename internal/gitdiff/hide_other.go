//go:build !windows

package gitdiff

import "os/exec"

func hideWindow(cmd *exec.Cmd) {}
