package files

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestListIsShallowPagedAndFocused(t *testing.T) {
	dir := t.TempDir()
	if err := os.Mkdir(filepath.Join(dir, "nested"), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "nested", "inside.md"), []byte("inside"), 0644); err != nil {
		t.Fatal(err)
	}
	for i := range 405 {
		if err := os.WriteFile(filepath.Join(dir, fmt.Sprintf("item%03d.md", i)), []byte("x"), 0644); err != nil {
			t.Fatal(err)
		}
	}
	s, err := New(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	first, err := s.List(context.Background(), "", 0, "")
	if err != nil || len(first.Entries) != PageSize || first.NextOffset == nil || *first.NextOffset != PageSize {
		t.Fatalf("first page: %+v %v", first, err)
	}
	if first.Entries[0].Path != "nested" || len(first.Entries[0].Children) != 0 {
		t.Fatalf("not shallow: %+v", first.Entries[0])
	}
	focused, err := s.List(context.Background(), "", 0, "item404.md")
	if err != nil || focused.Offset != 400 || len(focused.Entries) != 6 || focused.Entries[5].Name != "item404.md" {
		t.Fatalf("focused page: %+v %v", focused, err)
	}
	if _, err := s.List(context.Background(), "", 1, ""); !errors.Is(err, ErrPath) {
		t.Fatalf("unaligned offset: %v", err)
	}
	if _, err := s.List(context.Background(), "", 0, "../outside"); !errors.Is(err, ErrPath) {
		t.Fatalf("invalid focus: %v", err)
	}
	nested, err := s.List(context.Background(), "nested", 0, "")
	if err != nil || len(nested.Entries) != 1 || nested.Entries[0].Path != "nested/inside.md" {
		t.Fatalf("nested page: %+v %v", nested, err)
	}
	if err := os.WriteFile(filepath.Join(dir, "new.md"), []byte("new"), 0644); err != nil {
		t.Fatal(err)
	}
	changed, err := s.List(context.Background(), "", 0, "")
	if err != nil || changed.Revision == first.Revision {
		t.Fatalf("revision did not change: %v", err)
	}
}

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

func TestFilePaths(t *testing.T) {
	dir := t.TempDir()
	for _, name := range []string{".hidden", "docs/deep/page.md", "node_modules/skip.js", ".git/config", ".venv/data"} {
		full := filepath.Join(dir, name)
		if err := os.MkdirAll(filepath.Dir(full), 0755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(full, []byte("ok"), 0644); err != nil {
			t.Fatal(err)
		}
	}
	for i := range 205 {
		name := filepath.Join(dir, "docs", fmt.Sprintf("item%03d.md", i))
		if err := os.WriteFile(name, []byte("ok"), 0644); err != nil {
			t.Fatal(err)
		}
	}
	s, err := New(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	paths, err := s.FilePaths(context.Background())
	if err != nil || len(paths) != 207 || paths[0] != ".hidden" || paths[len(paths)-1] != "docs/item204.md" {
		t.Fatalf("paths: %d %+v %v", len(paths), paths, err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := s.FilePaths(ctx); !errors.Is(err, context.Canceled) {
		t.Fatalf("canceled scan: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "docs", "new.md"), []byte("ok"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(filepath.Join(dir, ".hidden")); err != nil {
		t.Fatal(err)
	}
	paths, err = s.FilePaths(context.Background())
	if err != nil || len(paths) != 207 || paths[0] != "docs/deep/page.md" || paths[len(paths)-1] != "docs/new.md" {
		t.Fatalf("updated paths: %d %+v %v", len(paths), paths, err)
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
