package files

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func TestSearchPathFilters(t *testing.T) {
	root := t.TempDir()
	for _, name := range []string{"docs/readme.md", "docs/skip.md", "root.md", "main.go"} {
		if err := os.MkdirAll(filepath.Dir(filepath.Join(root, name)), 0755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(root, name), []byte("needle"), 0644); err != nil {
			t.Fatal(err)
		}
	}
	store, err := New(root)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	result, err := store.Search(context.Background(), SearchOptions{Query: "needle", Include: []string{"docs/**/*.md"}, Exclude: []string{"skip.*"}})
	if err != nil || len(result.Matches) != 1 || result.Matches[0].Path != "docs/readme.md" || result.FilesScanned != 1 {
		t.Fatalf("filtered search: %+v, %v", result, err)
	}
	if _, err := store.Search(context.Background(), SearchOptions{Query: "needle", Include: []string{"["}}); !errors.Is(err, ErrQuery) {
		t.Fatalf("accepted invalid filter: %v", err)
	}
}

func TestSearchPatterns(t *testing.T) {
	for _, tc := range []struct {
		pattern, name string
		want          bool
	}{
		{"*.md", "docs/readme.md", true},
		{"*.md", "docs/readme.go", false},
		{"docs/*.md", "docs/sub/readme.md", false},
		{"docs/**", "docs/readme.md", true},
		{"docs/**", "docs/sub/readme.md", true},
		{"docs/**", "docs", false},
		{"**/**", "readme.md", true},
		{"docs/**/*.md", "docs/readme.md", true},
		{"docs/**/*.md", "docs/sub/deep/readme.md", true},
		{"**/*.md", "readme.md", true},
		{"**/test/**/a?.[gt]o", "test/a1.go", true},
		{"**/test/**/a?.[gt]o", "x/test/y/z/a1.go", true},
		{"docs/**/a.md", "other/a.md", false},
	} {
		if got := matchSearchPattern(tc.pattern, tc.name); got != tc.want {
			t.Errorf("match(%q, %q) = %v; want %v", tc.pattern, tc.name, got, tc.want)
		}
	}
	got, err := ParseSearchPatterns(" *.md, docs/** , , *.go ")
	if err != nil || !reflect.DeepEqual(got, []string{"*.md", "docs/**", "*.go"}) {
		t.Fatalf("normalize = %v, %v", got, err)
	}
	got, err = ParseSearchPatterns(strings.Repeat(", ", 21) + "*.md")
	if err != nil || !reflect.DeepEqual(got, []string{"*.md"}) {
		t.Fatalf("empty patterns counted toward limit: %v, %v", got, err)
	}
	for _, raw := range []string{"[", "docs/[x", "/absolute", "../outside", "a//b", strings.Repeat("*.md,", 20) + "*.go"} {
		if _, err := ParseSearchPatterns(raw); !errors.Is(err, ErrQuery) {
			t.Errorf("accepted %q: %v", raw, err)
		}
	}
	if searchPathIncluded("docs/hidden.md", []string{"*.md"}, []string{"docs/**"}) {
		t.Fatal("include overrode exclude")
	}
	if !searchPathIncluded("docs/readme.md", []string{"*.md"}, nil) || searchPathIncluded("main.go", []string{"*.md"}, nil) {
		t.Fatal("include filter not applied")
	}
}
