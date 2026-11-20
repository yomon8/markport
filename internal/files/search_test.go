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

func TestSearchOptions(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "sample.txt"), []byte("BUG-123\nbug-2 extra\nbug_3\nnext\nline\n"), 0644); err != nil {
		t.Fatal(err)
	}
	store, err := New(root)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	result, err := store.Search(context.Background(), SearchOptions{Query: `bug-\d+`, Regex: true, CaseSensitive: true})
	if err != nil || len(result.Matches) != 1 || result.Matches[0].Line != 2 {
		t.Fatalf("case-sensitive regex search: %+v, %v", result, err)
	}
	result, err = store.Search(context.Background(), SearchOptions{Query: "bug", WholeWord: true})
	if err != nil || len(result.Matches) != 2 {
		t.Fatalf("whole-word search: %+v, %v", result, err)
	}
	result, err = store.Search(context.Background(), SearchOptions{Query: `(?s)next\s+line`, Regex: true})
	if err != nil || len(result.Matches) != 0 {
		t.Fatalf("matched across lines: %+v, %v", result, err)
	}
	if _, err := store.Search(context.Background(), SearchOptions{Query: "[", Regex: true}); !errors.Is(err, ErrQuery) {
		t.Fatalf("invalid regexp: %v", err)
	}
	if err := os.WriteFile(filepath.Join(root, "sample.txt"), []byte(strings.Repeat("İ", 200)+" needle"), 0644); err != nil {
		t.Fatal(err)
	}
	result, err = store.Search(context.Background(), SearchOptions{Query: "needle", WholeWord: true})
	if err != nil || len(result.Matches) != 1 || !strings.HasSuffix(result.Matches[0].Text, " needle") {
		t.Fatalf("Unicode whole-word snippet: %+v, %v", result, err)
	}
}

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

func TestSearchSkipsPDFAndEarlySniffsBinary(t *testing.T) {
	root := t.TempDir()
	// Create a PDF containing the query string plus large binary files whose total
	// size exceeds MaxSearchBytes; none should prevent searching the text file.
	if err := os.WriteFile(filepath.Join(root, "doc.pdf"), []byte("%PDF-1.4\nneedle\n"), 0644); err != nil {
		t.Fatal(err)
	}
	bin := make([]byte, 9<<20)
	copy(bin, []byte("needle\x00binary"))
	for i := range 8 {
		if err := os.WriteFile(filepath.Join(root, fmt.Sprintf("a_bin%02d.dat", i)), bin, 0644); err != nil {
			t.Fatal(err)
		}
	}
	// Multi-byte UTF-8 rune ("あ" = 3 bytes) spanning the 8192-byte probe boundary.
	boundary := strings.Repeat("a", 8191) + "あ" + "\nneedle here\n"
	if err := os.WriteFile(filepath.Join(root, "z_utf8.txt"), []byte(boundary), 0644); err != nil {
		t.Fatal(err)
	}
	store, err := New(root)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	result, err := store.SearchContent(context.Background(), "", "needle")
	if err != nil {
		t.Fatal(err)
	}
	if result.Limit != "" {
		t.Fatalf("unexpected limit %q: %+v", result.Limit, result)
	}
	if len(result.Matches) != 1 || result.Matches[0].Path != "z_utf8.txt" || result.Matches[0].Line != 2 {
		t.Fatalf("expected only z_utf8.txt match, got %+v", result.Matches)
	}
	if result.BytesRead != int64(len(boundary)) {
		t.Fatalf("expected BytesRead=%d, got %d", len(boundary), result.BytesRead)
	}
}

func TestSearchMatchOffsets(t *testing.T) {
	root := t.TempDir()
	longLine := "   " + strings.Repeat("a", 120) + "日本語ターゲット" + strings.Repeat("b", 120) + "   \n"
	content := "  hello Needle world  \n" + longLine + "code bug-42 end\n"
	if err := os.WriteFile(filepath.Join(root, "notes.md"), []byte(content), 0644); err != nil {
		t.Fatal(err)
	}
	store, err := New(root)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	res, err := store.Search(context.Background(), SearchOptions{Query: "needle"})
	if err != nil || len(res.Matches) != 1 {
		t.Fatalf("ascii match: %+v, %v", res, err)
	}
	m := res.Matches[0]
	if got := string([]rune(m.Text)[m.MatchStart:m.MatchEnd]); got != "Needle" {
		t.Fatalf("ascii slice = %q (text=%q, %d:%d)", got, m.Text, m.MatchStart, m.MatchEnd)
	}

	res, err = store.Search(context.Background(), SearchOptions{Query: "ターゲット"})
	if err != nil || len(res.Matches) != 1 {
		t.Fatalf("japanese trimmed match: %+v, %v", res, err)
	}
	m = res.Matches[0]
	if got := string([]rune(m.Text)[m.MatchStart:m.MatchEnd]); got != "ターゲット" {
		t.Fatalf("japanese slice = %q (text=%q, %d:%d)", got, m.Text, m.MatchStart, m.MatchEnd)
	}

	res, err = store.Search(context.Background(), SearchOptions{Query: `bug-\d+`, Regex: true})
	if err != nil || len(res.Matches) != 1 {
		t.Fatalf("regex match: %+v, %v", res, err)
	}
	m = res.Matches[0]
	if got := string([]rune(m.Text)[m.MatchStart:m.MatchEnd]); got != "bug-42" {
		t.Fatalf("regex slice = %q (text=%q, %d:%d)", got, m.Text, m.MatchStart, m.MatchEnd)
	}
}
