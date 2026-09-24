package files

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestReadAndTree(t *testing.T) {
	dir := t.TempDir()
	for _, name := range []string{".hidden", "good.md", "node_modules/skip.js", ".git/config", ".venv/data"} {
		full := filepath.Join(dir, name)
		if err := os.MkdirAll(filepath.Dir(full), 0755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(full, []byte("ok"), 0644); err != nil {
			t.Fatal(err)
		}
	}
	s, err := New(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	for _, name := range []string{".hidden", "good.md"} {
		v, err := s.ReadText(name)
		if err != nil || v != "ok" {
			t.Fatalf("%s: %q %v", name, v, err)
		}
	}
	for _, name := range []string{"../outside", "/etc/passwd", "node_modules/skip.js", ".git/config", "", "good.md/../.hidden"} {
		if _, err := s.ReadText(name); err == nil {
			t.Errorf("accepted %q", name)
		}
	}
	nodes, err := s.Tree()
	if err != nil {
		t.Fatal(err)
	}
	if len(nodes) != 2 {
		t.Fatalf("tree: %+v", nodes)
	}
	if err := os.WriteFile(filepath.Join(dir, "binary"), []byte{0, 1, 2}, 0644); err != nil {
		t.Fatal(err)
	}
	if _, err := s.ReadText("binary"); !errors.Is(err, ErrBinary) {
		t.Fatalf("binary: %v", err)
	}
}

func TestTextLimit(t *testing.T) {
	dir := t.TempDir()
	s, err := New(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	if err := os.WriteFile(filepath.Join(dir, "limit"), []byte(strings.Repeat("a", MaxTextSize)), 0644); err != nil {
		t.Fatal(err)
	}
	if _, err := s.ReadText("limit"); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "limit"), []byte(strings.Repeat("a", MaxTextSize+1)), 0644); err != nil {
		t.Fatal(err)
	}
	if _, err := s.ReadText("limit"); !errors.Is(err, ErrTooLarge) {
		t.Fatalf("limit: %v", err)
	}
}

func TestGrowthAfterSizeCheck(t *testing.T) {
	// The observed size is at the limit, but the reader contains one new byte.
	_, err := readBounded(strings.NewReader(strings.Repeat("x", MaxTextSize+1)), MaxTextSize, MaxTextSize)
	if !errors.Is(err, ErrTooLarge) {
		t.Fatalf("growth: %v", err)
	}
}
