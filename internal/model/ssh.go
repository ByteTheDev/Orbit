package model

// SSHAuthMethod is how an SSH profile authenticates.
type SSHAuthMethod string

const (
	SSHAuthPassword SSHAuthMethod = "password"
	SSHAuthKey      SSHAuthMethod = "key"
	SSHAuthAgent    SSHAuthMethod = "agent"
)

// SSHProfile is one saved SSH connection. Secrets (passwords, passphrases) are stored
// alongside the rest of Orbit's state, which is user-local.
type SSHProfile struct {
	ID         string        `json:"id"`
	Name       string        `json:"name"`
	Host       string        `json:"host"`
	Port       int           `json:"port"`
	User       string        `json:"user"`
	Auth       SSHAuthMethod `json:"auth"`
	Password   string        `json:"password,omitempty"`
	KeyPath    string        `json:"keyPath,omitempty"`
	Passphrase string        `json:"passphrase,omitempty"`
	CreatedAt  int64         `json:"createdAt"`
}
