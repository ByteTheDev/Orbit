//go:build windows

package opener

import (
	"os/exec"
	"syscall"
)

// openPath uses the shell's own handler, the same one Explorer uses for a double click.
func openPath(path string) error {
	cmd := exec.Command("rundll32", "url.dll,FileProtocolHandler", path)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000}
	return cmd.Start()
}
