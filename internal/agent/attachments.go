package agent

import (
	"encoding/base64"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"orbit/internal/model"
	"orbit/internal/provider"
)

// imageExts maps the image types the chat accepts to the file extension each is stored with.
var imageExts = map[string]string{
	"image/png":  ".png",
	"image/jpeg": ".jpg",
	"image/gif":  ".gif",
	"image/webp": ".webp",
}

// storedImage is an attachment whose file has been written to the attachment folder.
type storedImage struct {
	att  model.Attachment
	path string
}

// SetAttachmentDir sets the folder where chat images are stored. Call it once at startup,
// before any message is sent. Images live beside the state file.
func (m *Manager) SetAttachmentDir(dir string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.attachmentDir = dir
}

// SetBrowserCommand sets the executable agents run to get the browser tool (Orbit itself, run
// with the browser MCP flag). Empty leaves agents without it. Call it once at startup.
func (m *Manager) SetBrowserCommand(cmd string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.browserCmd = cmd
}

// saveImages checks the uploads and writes them to the attachment folder, in order. Nothing is
// left behind when an upload is rejected.
func (m *Manager) saveImages(uploads []model.ImageUpload) ([]storedImage, error) {
	if len(uploads) == 0 {
		return nil, nil
	}
	if len(uploads) > model.MaxAttachments {
		return nil, fmt.Errorf("attach at most %d images to a message", model.MaxAttachments)
	}
	m.mu.Lock()
	dir := m.attachmentDir
	m.mu.Unlock()
	if dir == "" {
		return nil, errors.New("image storage is not ready")
	}
	var out []storedImage
	for _, u := range uploads {
		s, err := saveImage(dir, u)
		if err != nil {
			removeImageFiles(out)
			return nil, err
		}
		out = append(out, s)
	}
	return out, nil
}

// saveImage decodes one upload, checks that its bytes really are the image type it claims, and
// writes it to dir.
func saveImage(dir string, u model.ImageUpload) (storedImage, error) {
	ext, ok := imageExts[u.MediaType]
	if !ok {
		return storedImage{}, errors.New("images must be PNG, JPEG, GIF or WebP")
	}
	data, err := base64.StdEncoding.DecodeString(u.Data)
	if err != nil || len(data) == 0 {
		return storedImage{}, errors.New("an attached image could not be read")
	}
	if len(data) > model.MaxAttachmentBytes {
		return storedImage{}, errors.New("each image must be 3.5 MB or smaller")
	}
	if http.DetectContentType(data) != u.MediaType {
		return storedImage{}, fmt.Errorf("%s is not a valid %s file", safeImageName(u.Name), u.MediaType)
	}
	id := newID()
	path := filepath.Join(dir, id+ext)
	if err := writeFileAtomic(path, data); err != nil {
		return storedImage{}, err
	}
	return storedImage{att: model.Attachment{ID: id, Name: safeImageName(u.Name), MediaType: u.MediaType}, path: path}, nil
}

// safeImageName keeps only the file name part and caps its length, for display in the chat.
func safeImageName(name string) string {
	name = filepath.Base(strings.ReplaceAll(name, "\\", "/"))
	if name == "." || name == "/" || name == "" {
		return "image"
	}
	if r := []rune(name); len(r) > 120 {
		name = string(r[:120])
	}
	return name
}

// attachmentPath is where an attachment's file lives. The id is reduced to its base name, so a
// crafted id cannot point outside the folder.
func attachmentPath(dir string, a model.Attachment) string {
	return filepath.Join(dir, filepath.Base(a.ID)+imageExts[a.MediaType])
}

// AttachmentImage returns an image from an agent's conversation as a data URL, so the webview can
// draw it without a file server. Only images the agent's messages refer to are returned.
func (m *Manager) AttachmentImage(agentID, attachmentID string) (string, error) {
	m.mu.Lock()
	rec, ok := m.agents[agentID]
	var att model.Attachment
	found := false
	if ok {
		for _, msg := range rec.Messages {
			for _, a := range msg.Attachments {
				if a.ID == attachmentID {
					att, found = a, true
				}
			}
		}
	}
	dir := m.attachmentDir
	m.mu.Unlock()
	if !ok {
		return "", ErrNotFound
	}
	if !found {
		return "", errors.New("that image is no longer in the conversation")
	}
	data, err := os.ReadFile(attachmentPath(dir, att))
	if err != nil {
		return "", fmt.Errorf("read image: %w", err)
	}
	return "data:" + att.MediaType + ";base64," + base64.StdEncoding.EncodeToString(data), nil
}

// removeAttachmentFilesLocked deletes the image files of an agent that is being removed. Caller holds m.mu.
func (m *Manager) removeAttachmentFilesLocked(rec *model.AgentRecord) {
	if m.attachmentDir == "" {
		return
	}
	for _, msg := range rec.Messages {
		for _, a := range msg.Attachments {
			_ = os.Remove(attachmentPath(m.attachmentDir, a))
		}
	}
}

// removeImageFiles deletes files written by saveImages, after the turn that would have used them
// could not start.
func removeImageFiles(images []storedImage) {
	for _, img := range images {
		_ = os.Remove(img.path)
	}
}

// attachmentsOf returns the message metadata for stored images. It is never nil, so the JSON
// stays a list.
func attachmentsOf(images []storedImage) []model.Attachment {
	out := make([]model.Attachment, 0, len(images))
	for _, img := range images {
		out = append(out, img.att)
	}
	return out
}

// providerImages converts stored images to the form a provider adapter reads.
func providerImages(images []storedImage) []provider.Image {
	out := make([]provider.Image, 0, len(images))
	for _, img := range images {
		out = append(out, provider.Image{Path: img.path, MediaType: img.att.MediaType})
	}
	return out
}
