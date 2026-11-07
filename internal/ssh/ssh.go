package ssh

import (
	"context"
	"errors"
	"fmt"
	"net"
	"os"
	"sort"
	"strings"
	"time"

	"golang.org/x/crypto/ssh"
	"golang.org/x/crypto/ssh/agent"

	"orbit/internal/model"
)

const DefaultPort = 22

// Normalize checks a profile's fields and returns them in stored form.
func Normalize(p model.SSHProfile) (model.SSHProfile, error) {
	p.Name = strings.TrimSpace(p.Name)
	p.Host = strings.TrimSpace(p.Host)
	p.User = strings.TrimSpace(p.User)
	p.KeyPath = strings.TrimSpace(p.KeyPath)
	switch {
	case p.Name == "":
		return p, errors.New("give the connection a name")
	case p.Host == "":
		return p, errors.New("enter a host name")
	case p.User == "":
		return p, errors.New("enter a user name")
	}
	if p.Port == 0 {
		p.Port = DefaultPort
	}
	if p.Port < 1 || p.Port > 65535 {
		return p, fmt.Errorf("the port must be between 1 and 65535")
	}
	if p.Auth == "" {
		p.Auth = model.SSHAuthKey
	}
	switch p.Auth {
	case model.SSHAuthPassword, model.SSHAuthKey, model.SSHAuthAgent:
	default:
		return p, fmt.Errorf("unknown authentication method %q", p.Auth)
	}
	if p.Auth == model.SSHAuthKey && p.KeyPath == "" {
		return p, errors.New("choose a private key file")
	}
	return p, nil
}

// AuthMethods builds the ssh.AuthMethod list for a profile.
func AuthMethods(p model.SSHProfile) ([]ssh.AuthMethod, error) {
	switch p.Auth {
	case model.SSHAuthPassword:
		return []ssh.AuthMethod{ssh.Password(p.Password)}, nil
	case model.SSHAuthKey:
		key, err := os.ReadFile(p.KeyPath)
		if err != nil {
			return nil, fmt.Errorf("could not read the private key: %w", err)
		}
		signer, err := ssh.ParsePrivateKey(key)
		if err != nil && len(p.Passphrase) > 0 {
			signer, err = ssh.ParsePrivateKeyWithPassphrase(key, []byte(p.Passphrase))
		}
		if err != nil {
			return nil, fmt.Errorf("could not parse the private key: %w", err)
		}
		return []ssh.AuthMethod{ssh.PublicKeys(signer)}, nil
	case model.SSHAuthAgent:
		conn, err := agentConn()
		if err != nil {
			return nil, err
		}
		ag := agent.NewClient(conn)
		signers, err := ag.Signers()
		if err != nil {
			_ = conn.Close()
			return nil, err
		}
		return []ssh.AuthMethod{ssh.PublicKeys(signers...)}, nil
	}
	return nil, fmt.Errorf("unknown authentication method %q", p.Auth)
}

// Dial opens an SSH connection to the profile's host.
func Dial(ctx context.Context, p model.SSHProfile) (*ssh.Client, error) {
	p, err := Normalize(p)
	if err != nil {
		return nil, err
	}
	methods, err := AuthMethods(p)
	if err != nil {
		return nil, err
	}
	cfg := &ssh.ClientConfig{
		User:            p.User,
		Auth:            methods,
		HostKeyCallback: ssh.InsecureIgnoreHostKey(),
		Timeout:         15 * time.Second,
	}
	addr := fmt.Sprintf("%s:%d", p.Host, p.Port)
	var d net.Dialer
	conn, err := d.DialContext(ctx, "tcp", addr)
	if err != nil {
		return nil, fmt.Errorf("could not reach %s: %w", addr, err)
	}
	c, chans, reqs, err := ssh.NewClientConn(conn, addr, cfg)
	if err != nil {
		_ = conn.Close()
		return nil, fmt.Errorf("SSH handshake failed: %w", err)
	}
	return ssh.NewClient(c, chans, reqs), nil
}

// Test opens a connection and runs a trivial command to confirm it works.
func Test(ctx context.Context, p model.SSHProfile) error {
	client, err := Dial(ctx, p)
	if err != nil {
		return err
	}
	defer client.Close()
	session, err := client.NewSession()
	if err != nil {
		return err
	}
	defer session.Close()
	if err := session.Run("true"); err != nil {
		session2, err2 := client.NewSession()
		if err2 != nil {
			return err
		}
		defer session2.Close()
		if err2 := session2.Run(""); err2 != nil {
			return err
		}
	}
	return nil
}

// Run executes command on the remote host and returns its combined output.
func Run(ctx context.Context, p model.SSHProfile, command string) (string, error) {
	client, err := Dial(ctx, p)
	if err != nil {
		return "", err
	}
	defer client.Close()
	session, err := client.NewSession()
	if err != nil {
		return "", err
	}
	defer session.Close()
	out, err := session.CombinedOutput(command)
	return string(out), err
}

// SortProfiles returns a copy sorted by creation time.
func SortProfiles(in []model.SSHProfile) []model.SSHProfile {
	out := append([]model.SSHProfile(nil), in...)
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt < out[j].CreatedAt })
	return out
}
