package files

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestSearchContentScopeSafetyAndContext(t *testing.T) {
	root := t.TempDir()
	for _, name := range []string{"docs", "other", "docs/node_modules"} {
		if err := os.MkdirAll(filepath.Join(root, name), 0755); err != nil {
			t.Fatal(err)
		}
	}
	for name, text := range map[string]string{
		"docs/a.md":                   "before\nNeedle here\nafter\n",
		"docs/b.go":                   "package main\n// needle again\n",
		"docs/node_modules/hidden.md": "needle excluded",
		"other/outside.md":            "needle outside scope",
		"docs/binary.bin":             "needle\x00binary",
		"docs/image.svg":              "<svg>needle</svg>",
	} {
		if err := os.WriteFile(filepath.Join(root, name), []byte(text), 0644); err != nil {
			t.Fatal(err)
		}
	}
	if runtime.GOOS != "windows" {
		if err := os.Symlink(filepath.Join(root, "other"), filepath.Join(root, "docs", "link")); err != nil {
			t.Fatal(err)
		}
	}
	store, err := New(root)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	result, err := store.SearchContent(context.Background(), "docs", "needle")
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Matches) != 2 || result.Matches[0].Path != "docs/a.md" || result.Matches[0].Line != 2 || result.Matches[0].Before != "before" || result.Matches[0].After != "after" || result.Matches[1].Path != "docs/b.go" {
		t.Fatalf("unexpected matches: %+v", result.Matches)
	}
	for _, folder := range []string{"../other", "docs/node_modules", "docs/link"} {
		if _, err := store.SearchContent(context.Background(), folder, "needle"); err == nil {
			t.Errorf("accepted folder %q", folder)
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := store.SearchContent(ctx, "docs", "needle"); !errors.Is(err, context.Canceled) {
		t.Fatalf("canceled search: %v", err)
	}
}

func TestSearchContentLimits(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "many.txt"), []byte(strings.Repeat("match\n", MaxSearchMatches+1)), 0644); err != nil {
		t.Fatal(err)
	}
	store, err := New(root)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	result, err := store.SearchContent(context.Background(), "", "match")
	if err != nil || result.Limit != "matches" || len(result.Matches) != MaxSearchMatches {
		t.Fatalf("match limit: %+v %v", result, err)
	}
	if err := os.Remove(filepath.Join(root, "many.txt")); err != nil {
		t.Fatal(err)
	}
	for i := range MaxSearchFiles + 1 {
		name := filepath.Join(root, fmt.Sprintf("file%04d.txt", i))
		if err := os.WriteFile(name, []byte("nothing"), 0644); err != nil {
			t.Fatal(err)
		}
	}
	result, err = store.SearchContent(context.Background(), "", "absent")
	if err != nil || result.Limit != "files" || result.FilesScanned != MaxSearchFiles {
		t.Fatalf("file limit: %+v %v", result, err)
	}
}

func TestSearchContentReadLimitAndLargeFile(t *testing.T) {
	root := t.TempDir()
	large := filepath.Join(root, "oversize.txt")
	if err := os.WriteFile(large, nil, 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.Truncate(large, MaxTextSize+1); err != nil {
		t.Fatal(err)
	}
	content := []byte(strings.Repeat("x", 9<<20))
	for i := range 8 {
		if err := os.WriteFile(filepath.Join(root, fmt.Sprintf("read%02d.txt", i)), content, 0644); err != nil {
			t.Fatal(err)
		}
	}
	store, err := New(root)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	result, err := store.SearchContent(context.Background(), "", "absent")
	if err != nil || result.Limit != "bytes" || result.BytesRead > MaxSearchBytes || result.FilesScanned > 9 {
		t.Fatalf("read limit: %+v %v", result, err)
	}
}
