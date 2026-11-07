package ssh

import (
	"fmt"
	"net"
	"os"
)

// agentConn dials the local SSH agent, if one is available.
func agentConn() (net.Conn, error) {
	if sock := os.Getenv("SSH_AUTH_SOCK"); sock != "" {
		conn, err := net.Dial("unix", sock)
		if err != nil {
			return nil, fmt.Errorf("could not reach the SSH agent: %w", err)
		}
		return conn, nil
	}
	// Windows named pipe used by OpenSSH.
	if conn, err := net.Dial("unix", `\\.\pipe\openssh-ssh-agent`); err == nil {
		return conn, nil
	}
	return nil, fmt.Errorf("no SSH agent is available (SSH_AUTH_SOCK is not set)")
}
