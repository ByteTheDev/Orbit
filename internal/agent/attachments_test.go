package agent

import (
	"bytes"
	"encoding/base64"
	"image"
	"image/png"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"orbit/internal/model"
)

// pngUpload is a valid 1×1 PNG, base64 encoded the way the window sends it.
func pngUpload(t *testing.T) model.ImageUpload {
	t.Helper()
	var buf bytes.Buffer
	if err := png.Encode(&buf, image.NewRGBA(image.Rect(0, 0, 1, 1))); err != nil {
		t.Fatal(err)
	}
	return model.ImageUpload{Name: "dot.png", MediaType: "image/png", Data: base64.StdEncoding.EncodeToString(buf.Bytes())}
}

func TestSaveImagesWritesValidPNG(t *testing.T) {
	m := New(func([]model.Event) {}, func() {})
	dir := t.TempDir()
	m.SetAttachmentDir(dir)

	got, err := m.saveImages([]model.ImageUpload{pngUpload(t)})
	if err != nil {
		t.Fatalf("saveImages: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("want 1 stored image, got %d", len(got))
	}
	if got[0].att.Name != "dot.png" || got[0].att.MediaType != "image/png" {
		t.Errorf("metadata = %+v", got[0].att)
	}
	if _, err := os.Stat(filepath.Join(dir, got[0].att.ID+".png")); err != nil {
		t.Errorf("file not written: %v", err)
	}
}

func TestSaveImagesRejectsMismatchedBytes(t *testing.T) {
	m := New(func([]model.Event) {}, func() {})
	m.SetAttachmentDir(t.TempDir())

	// Claims to be a PNG but holds plain text.
	bad := model.ImageUpload{Name: "fake.png", MediaType: "image/png", Data: base64.StdEncoding.EncodeToString([]byte("not an image at all"))}
	if _, err := m.saveImages([]model.ImageUpload{bad}); err == nil {
		t.Fatal("want an error for bytes that are not a PNG")
	}
}

func TestSaveImagesRejectsTooManyAndUnknownTypes(t *testing.T) {
	m := New(func([]model.Event) {}, func() {})
	m.SetAttachmentDir(t.TempDir())

	many := make([]model.ImageUpload, model.MaxAttachments+1)
	for i := range many {
		many[i] = pngUpload(t)
	}
	if _, err := m.saveImages(many); err == nil || !strings.Contains(err.Error(), "at most") {
		t.Errorf("want a count error, got %v", err)
	}

	svg := pngUpload(t)
	svg.MediaType = "image/svg+xml"
	if _, err := m.saveImages([]model.ImageUpload{svg}); err == nil {
		t.Error("want an error for an unsupported media type")
	}
}

func TestSaveImagesRemovesEarlierFilesOnFailure(t *testing.T) {
	m := New(func([]model.Event) {}, func() {})
	dir := t.TempDir()
	m.SetAttachmentDir(dir)

	bad := model.ImageUpload{Name: "x.png", MediaType: "image/png", Data: "!!!not base64"}
	if _, err := m.saveImages([]model.ImageUpload{pngUpload(t), bad}); err == nil {
		t.Fatal("want an error")
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 0 {
		t.Errorf("failed send left %d file(s) behind", len(entries))
	}
}

func TestSafeImageNameKeepsOnlyBaseName(t *testing.T) {
	if got := safeImageName("../../secret/evil.png"); got != "evil.png" {
		t.Errorf("safeImageName = %q", got)
	}
	if got := safeImageName(""); got != "image" {
		t.Errorf("empty name = %q, want image", got)
	}
}
