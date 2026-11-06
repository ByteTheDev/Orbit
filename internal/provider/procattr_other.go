//go:build !windows

package provider

import (
	"os"
	"os/exec"
	"syscall"
)

// configureProcess puts the child in its own process group so the whole tree can be signalled.
func configureProcess(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
}

// killTree terminates the process group.
func killTree(p *os.Process) error {
	if p == nil {
		return nil
	}
	if err := syscall.Kill(-p.Pid, syscall.SIGKILL); err == nil {
		return nil
	}
	return p.Kill()
}
