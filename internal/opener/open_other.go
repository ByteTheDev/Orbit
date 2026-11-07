//go:build !windows

package opener

import "os/exec"

// openPath hands the file to the desktop's opener. On macOS that is "open", elsewhere "xdg-open".
func openPath(path string) error {
	name := "xdg-open"
	if _, err := exec.LookPath("open"); err == nil {
		if _, err := exec.LookPath("xdg-open"); err != nil {
			name = "open"
		}
	}
	return exec.Command(name, path).Start()
}
