package provider

import (
	"encoding/base64"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestClaudeStdinTextOnlyIsPlainPrompt(t *testing.T) {
	got, err := claudeStdin(Spec{Prompt: "hello"})
	if err != nil {
		t.Fatal(err)
	}
	if got != "hello" {
		t.Errorf("stdin = %q, want the plain prompt", got)
	}
}

func TestClaudeStdinWithImageIsStreamJSON(t *testing.T) {
	path := filepath.Join(t.TempDir(), "a.png")
	if err := os.WriteFile(path, []byte("PNGBYTES"), 0o600); err != nil {
		t.Fatal(err)
	}
	got, err := claudeStdin(Spec{Prompt: "what is this", Images: []Image{{Path: path, MediaType: "image/png"}}})
	if err != nil {
		t.Fatal(err)
	}

	var msg struct {
		Type    string `json:"type"`
		Message struct {
			Role    string           `json:"role"`
			Content []map[string]any `json:"content"`
		} `json:"message"`
	}
	if err := json.Unmarshal([]byte(strings.TrimSpace(got)), &msg); err != nil {
		t.Fatalf("stdin is not one JSON message: %v\n%s", err, got)
	}
	if msg.Type != "user" || msg.Message.Role != "user" {
		t.Errorf("envelope = %q/%q, want user/user", msg.Type, msg.Message.Role)
	}
	if len(msg.Message.Content) != 2 {
		t.Fatalf("want text plus one image block, got %d blocks", len(msg.Message.Content))
	}
	if msg.Message.Content[0]["text"] != "what is this" {
		t.Errorf("text block = %v", msg.Message.Content[0])
	}
	img := msg.Message.Content[1]
	source, _ := img["source"].(map[string]any)
	if img["type"] != "image" || source["type"] != "base64" || source["media_type"] != "image/png" {
		t.Errorf("image block = %v", img)
	}
	if source["data"] != base64.StdEncoding.EncodeToString([]byte("PNGBYTES")) {
		t.Errorf("image data is not the file's base64")
	}
}

func TestClaudeArgsAddInputFormatOnlyWithImages(t *testing.T) {
	plain := strings.Join(claudeArgs(Spec{Prompt: "x"}), " ")
	if strings.Contains(plain, "--input-format") {
		t.Errorf("text-only turn should not change input format: %s", plain)
	}
	withImage := strings.Join(claudeArgs(Spec{Images: []Image{{Path: "a.png", MediaType: "image/png"}}}), " ")
	if !strings.Contains(withImage, "--input-format stream-json") {
		t.Errorf("turn with images needs stream-json input: %s", withImage)
	}
}

func TestCodexArgsPassEachImageBeforePromptMarker(t *testing.T) {
	args := codexArgs(Spec{Images: []Image{{Path: "C:/x/a.png", MediaType: "image/png"}, {Path: "C:/x/b.jpg", MediaType: "image/jpeg"}}})
	if args[len(args)-1] != "-" {
		t.Fatalf("prompt marker must stay last: %v", args)
	}
	joined := strings.Join(args, " ")
	for _, want := range []string{"--image=C:/x/a.png", "--image=C:/x/b.jpg"} {
		if !strings.Contains(joined, want) {
			t.Errorf("missing %s in %v", want, args)
		}
	}
}
