//go:build windows

package files

import (
	"os/exec"
	"path/filepath"
	"syscall"
)

// revealPath opens Explorer with the entry selected. Explorer exits with status 1 even on success,
// so the process is started and not waited for.
func revealPath(path string) error {
	cmd := exec.Command("explorer.exe", "/select,"+filepath.Clean(path))
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000}
	return cmd.Start()
}
