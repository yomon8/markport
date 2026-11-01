package files

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestSearchCandidateOrderAndSafety(t *testing.T) {
	root := t.TempDir()
	for name, text := range map[string]string{
		"docs/normal.md": "needle normal", "docs/deferred.md": "needle deferred",
		"docs2/outside.md": "needle wrong folder", "node_modules/hidden.md": "needle excluded",
	} {
		if err := os.MkdirAll(filepath.Dir(filepath.Join(root, name)), 0755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(root, name), []byte(text), 0644); err != nil {
			t.Fatal(err)
		}
	}
	if runtime.GOOS != "windows" {
		if err := os.Symlink(filepath.Join(root, "docs/normal.md"), filepath.Join(root, "link.md")); err != nil {
			t.Fatal(err)
		}
		if err := os.Symlink(filepath.Join(root, "docs"), filepath.Join(root, "linked")); err != nil {
			t.Fatal(err)
		}
	}
	store, err := New(root)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	opts := SearchOptions{Query: "needle", Candidates: []string{"link.md", "linked/normal.md", "node_modules/hidden.md", "../outside.md", "docs/normal.md"}, Deferred: []string{"docs/deferred.md", "docs/normal.md"}}
	result, err := store.Search(context.Background(), opts)
	if err != nil || len(result.Matches) != 2 || result.Matches[0].Path != "docs/normal.md" || result.Matches[1].Path != "docs/deferred.md" {
		t.Fatalf("ordered safe candidates: %+v, %v", result, err)
	}
	opts.Folder = "docs"
	opts.Candidates = append(opts.Candidates, "docs2/outside.md")
	result, err = store.Search(context.Background(), opts)
	if err != nil || len(result.Matches) != 2 {
		t.Fatalf("folder scope: %+v, %v", result, err)
	}
	result, err = store.Search(context.Background(), SearchOptions{Query: "needle", Candidates: []string{}})
	if err != nil || len(result.Matches) != 0 || result.FilesScanned != 0 {
		t.Fatalf("walked an explicitly empty list: %+v, %v", result, err)
	}
}

func TestSearchDeferredLimits(t *testing.T) {
	root := t.TempDir()
	var candidates, deferred []string
	for i := range MaxSearchFiles + 1 {
		name := fmt.Sprintf("%04d.txt", i)
		if err := os.WriteFile(filepath.Join(root, name), []byte("absent"), 0644); err != nil {
			t.Fatal(err)
		}
		if i < MaxSearchFiles-1 {
			candidates = append(candidates, name)
		} else {
			deferred = append(deferred, name)
		}
	}
	store, err := New(root)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	result, err := store.Search(context.Background(), SearchOptions{Query: "needle", Candidates: candidates, Deferred: deferred})
	if err != nil || result.FilesScanned != MaxSearchFiles || result.Limit != "files" {
		t.Fatalf("combined file limit: %+v, %v", result, err)
	}
	if err := os.WriteFile(filepath.Join(root, "matches.txt"), []byte(strings.Repeat("needle\n", MaxSearchMatches)), 0644); err != nil {
		t.Fatal(err)
	}
	result, err = store.Search(context.Background(), SearchOptions{Query: "needle", Candidates: []string{"matches.txt"}, Deferred: deferred})
	if err != nil || result.FilesScanned != 1 || result.Limit != "matches" || len(result.Matches) != MaxSearchMatches {
		t.Fatalf("deferred read after match limit: %+v, %v", result, err)
	}
}
