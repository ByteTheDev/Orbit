// Package terminal runs interactive shells in pseudo-terminals (ConPTY on Windows).
// Each terminal is an ordinary shell started in a project's repository folder, so
// the user gets the same shell they would get outside Orbit.
package terminal

import (
	"errors"
	"fmt"
	"os"
	"sync"
	"unicode/utf8"

	pty "github.com/aymanbagabas/go-pty"
)

const (
	maxBatch  = 64 << 10 // bytes sent to the window in one event at most
	readSize  = 16 << 10
	maxCells  = 1000 // generous upper bound on columns and rows
	chunkSlot = 64   // buffered reads waiting to be batched
)

var (
	ErrExists   = errors.New("that terminal is already open")
	ErrNotFound = errors.New("that terminal is not open")
)

// Manager owns every open terminal. Output and exit are delivered through callbacks,
// which must not block.
type Manager struct {
	mu       sync.Mutex
	sessions map[string]*session
	onOutput func(id, data string)
	onExit   func(id string)
}

type session struct {
	pty pty.Pty
	cmd *pty.Cmd
}

// New creates a manager. onOutput receives text as it is produced; onExit fires once a
// terminal's shell has ended and all its output has been delivered.
func New(onOutput func(id, data string), onExit func(id string)) *Manager {
	return &Manager{sessions: map[string]*session{}, onOutput: onOutput, onExit: onExit}
}

// Open starts a shell in dir, sized cols × rows. The id is chosen by the caller, so the
// window can register it before the first output arrives.
func (m *Manager) Open(id, dir string, cols, rows int) error {
	if id == "" {
		return errors.New("terminal id is required")
	}
	if info, err := os.Stat(dir); err != nil || !info.IsDir() {
		return errors.New("the project's repository folder is missing")
	}
	cols, rows = clampSize(cols), clampSize(rows)

	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.sessions[id]; ok {
		return ErrExists
	}

	p, err := pty.New()
	if err != nil {
		return fmt.Errorf("could not create a terminal: %w", err)
	}
	if err := p.Resize(cols, rows); err != nil {
		p.Close()
		return err
	}
	cmd := p.Command(shell())
	cmd.Dir = dir
	if err := cmd.Start(); err != nil {
		p.Close()
		return fmt.Errorf("could not start the shell: %w", err)
	}

	s := &session{pty: p, cmd: cmd}
	m.sessions[id] = s
	go m.run(id, s)
	return nil
}

// Write sends keystrokes to a terminal.
func (m *Manager) Write(id, data string) error {
	s, err := m.get(id)
	if err != nil {
		return err
	}
	_, err = s.pty.Write([]byte(data))
	return err
}

// Resize tells a terminal its new size in cells.
func (m *Manager) Resize(id string, cols, rows int) error {
	s, err := m.get(id)
	if err != nil {
		return err
	}
	return s.pty.Resize(clampSize(cols), clampSize(rows))
}

// Close ends a terminal and its shell.
func (m *Manager) Close(id string) error {
	m.mu.Lock()
	s, ok := m.sessions[id]
	delete(m.sessions, id)
	m.mu.Unlock()
	if !ok {
		return ErrNotFound
	}
	kill(s)
	return nil
}

// CloseAll ends every terminal. Called when the app shuts down.
func (m *Manager) CloseAll() {
	m.mu.Lock()
	all := m.sessions
	m.sessions = map[string]*session{}
	m.mu.Unlock()
	for _, s := range all {
		kill(s)
	}
}

func (m *Manager) get(id string) (*session, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	s, ok := m.sessions[id]
	if !ok {
		return nil, ErrNotFound
	}
	return s, nil
}

func kill(s *session) {
	if s.cmd.Process != nil {
		_ = s.cmd.Process.Kill()
	}
	_ = s.pty.Close()
}

// run reads the terminal's output until the shell exits, then reports the exit.
func (m *Manager) run(id string, s *session) {
	chunks := make(chan []byte, chunkSlot)
	readerDone := make(chan struct{})
	go func() {
		defer close(readerDone)
		defer close(chunks)
		buf := make([]byte, readSize)
		for {
			n, err := s.pty.Read(buf)
			if n > 0 {
				chunk := make([]byte, n)
				copy(chunk, buf[:n])
				chunks <- chunk
			}
			if err != nil {
				return
			}
		}
	}()

	// Emitter: batch whatever has piled up, so a burst of output is one event, not thousands.
	var carry []byte
	emitted := make(chan struct{})
	go func() {
		defer close(emitted)
		for chunk := range chunks {
			text, rest := splitUTF8(append(carry, drain(chunks, chunk)...))
			carry = rest
			if text != "" {
				m.onOutput(id, text)
			}
		}
		if len(carry) > 0 {
			m.onOutput(id, string(carry))
		}
	}()

	_ = s.cmd.Wait()
	_ = s.pty.Close() // unblocks the reader if the shell left the pipe open
	<-readerDone
	<-emitted

	m.mu.Lock()
	if m.sessions[id] == s {
		delete(m.sessions, id)
	}
	m.mu.Unlock()
	m.onExit(id)
}

// drain appends chunks that are already queued to batch, up to maxBatch, without waiting.
func drain(chunks <-chan []byte, batch []byte) []byte {
	for len(batch) < maxBatch {
		select {
		case more, ok := <-chunks:
			if !ok {
				return batch
			}
			batch = append(batch, more...)
		default:
			return batch
		}
	}
	return batch
}

// splitUTF8 returns the longest prefix that ends on a complete UTF-8 sequence, and the
// bytes after it. A character split across two reads is held back, not turned into �.
func splitUTF8(b []byte) (string, []byte) {
	for i := len(b) - 1; i >= 0 && i >= len(b)-utf8.UTFMax+1; i-- {
		if utf8.RuneStart(b[i]) {
			if !utf8.FullRune(b[i:]) {
				rest := append([]byte(nil), b[i:]...)
				return string(b[:i]), rest
			}
			break
		}
	}
	return string(b), nil
}

func clampSize(n int) int {
	if n < 1 {
		return 1
	}
	if n > maxCells {
		return maxCells
	}
	return n
}
