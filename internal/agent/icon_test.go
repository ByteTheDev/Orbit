package agent

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"orbit/internal/model"
)

func pngBytes(t *testing.T, w, h int) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for i := range img.Pix {
		img.Pix[i] = 200
	}
	img.Set(0, 0, color.RGBA{255, 0, 0, 255})
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func TestProjectIconImageRoundTrip(t *testing.T) {
	m, _, _ := newTestManager(t)
	dir := t.TempDir()
	m.SetIconDir(dir)
	proj, err := m.CreateProject("Icons", t.TempDir())
	if err != nil {
		t.Fatal(err)
	}

	if got, _ := m.ProjectIconImage(proj.ID); got != "" {
		t.Fatalf("new project should have no image, got %q", got[:min(len(got), 30)])
	}

	if err := m.SetProjectIconImage(proj.ID, pngBytes(t, 8, 8)); err != nil {
		t.Fatalf("valid PNG rejected: %v", err)
	}
	url, err := m.ProjectIconImage(proj.ID)
	if err != nil || !strings.HasPrefix(url, "data:image/png;base64,") {
		t.Fatalf("expected a PNG data URL, got %q (%v)", url, err)
	}
	if _, err := os.Stat(filepath.Join(dir, proj.ID+".png")); err != nil {
		t.Fatalf("icon file not written: %v", err)
	}
	m.mu.Lock()
	rev := m.projects[proj.ID].IconRev
	m.mu.Unlock()
	if rev == 0 {
		t.Fatal("upload should set a non-zero IconRev")
	}
}

func TestProjectIconRejectsBadInput(t *testing.T) {
	m, _, _ := newTestManager(t)
	m.SetIconDir(t.TempDir())
	proj, _ := m.CreateProject("Bad", t.TempDir())

	cases := map[string][]byte{
		"empty":     {},
		"not a png": []byte("GIF89a not really"),
		"too big":   make([]byte, model.MaxIconBytes+1),
		"too wide":  pngBytes(t, model.MaxIconPixels+1, 4),
	}
	for name, data := range cases {
		if err := m.SetProjectIconImage(proj.ID, data); err == nil {
			t.Errorf("%s: expected rejection", name)
		}
	}
	if got, _ := m.ProjectIconImage(proj.ID); got != "" {
		t.Error("rejected uploads must not leave an image behind")
	}
}

func TestLetterClearsImageAndDeleteRemovesFile(t *testing.T) {
	m, _, _ := newTestManager(t)
	dir := t.TempDir()
	m.SetIconDir(dir)
	proj, _ := m.CreateProject("Swap", t.TempDir())
	if err := m.SetProjectIconImage(proj.ID, pngBytes(t, 4, 4)); err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(dir, proj.ID+".png")

	if err := m.SetProjectIcon(proj.ID, "Q"); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(file); !os.IsNotExist(err) {
		t.Fatal("choosing a letter should remove the uploaded image file")
	}

	if err := m.SetProjectIconImage(proj.ID, pngBytes(t, 4, 4)); err != nil {
		t.Fatal(err)
	}
	if err := m.DeleteProject(proj.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(file); !os.IsNotExist(err) {
		t.Fatal("deleting a project should remove its icon file")
	}
}

func TestIconPathCannotEscapeFolder(t *testing.T) {
	dir := t.TempDir()
	got := iconPath(dir, "../../evil")
	if filepath.Dir(got) != filepath.Clean(dir) {
		t.Fatalf("icon path escaped its folder: %s", got)
	}
}
