package files

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func TestSearchContentLineBoundariesAndUnicode(t *testing.T) {
	for _, test := range []struct {
		name, content, query string
		want                 []ContentMatch
	}{
		{"first", "NEEDLE\nfollowing\n", "needle", []ContentMatch{{Path: "file.txt", Line: 1, Text: "NEEDLE", After: "following"}}},
		{"last", "before\nNeEdLe", "NEEDLE", []ContentMatch{{Path: "file.txt", Line: 2, Text: "NeEdLe", Before: "before"}}},
		{"single", "needle", "needle", []ContentMatch{{Path: "file.txt", Line: 1, Text: "needle"}}},
		{"unicode-context", "İ filler\nNEEDLE\nİ context", "needle", []ContentMatch{{Path: "file.txt", Line: 2, Text: "NEEDLE", Before: "İ filler", After: "İ context"}}},
		{"crlf", "before\r\nNeedle\r\nafter\r\n", "needle", []ContentMatch{{Path: "file.txt", Line: 2, Text: "Needle", Before: "before", After: "after"}}},
		{"folded-offset", "İ start NEEDLE\n", "needle", []ContentMatch{{Path: "file.txt", Line: 1, Text: "İ start NEEDLE"}}},
		{"folded-query", "İ\n", "i", []ContentMatch{{Path: "file.txt", Line: 1, Text: "İ"}}},
		{"full-context", "İ" + strings.Repeat("x", 120) + "NEEDLE" + strings.Repeat("y", 20), "needle", []ContentMatch{{Path: "file.txt", Line: 1, Text: "İ" + strings.Repeat("x", 120) + "NEEDLE" + strings.Repeat("y", 20)}}},
		{"multiline", "before\nneedle\nafter", "before\nneedle", []ContentMatch{}},
		{"absent", "there is no matching text\n", "needle", []ContentMatch{}},
	} {
		t.Run(test.name, func(t *testing.T) {
			dir := t.TempDir()
			if err := os.WriteFile(filepath.Join(dir, "file.txt"), []byte(test.content), 0600); err != nil {
				t.Fatal(err)
			}
			store, err := New(dir)
			if err != nil {
				t.Fatal(err)
			}
			defer store.Close()
			result, err := store.SearchContent(context.Background(), "", test.query)
			if err != nil || result.Limit != "" || !reflect.DeepEqual(result.Matches, test.want) || result.FilesScanned != 1 || result.BytesRead != int64(len(test.content)) {
				t.Fatalf("got %+v err=%v want=%+v", result, err, test.want)
			}
		})
	}
}

func TestSearchContentEntryLimit(t *testing.T) {
	dir := t.TempDir()
	// Image entries consume the entry budget without consuming file budget.
	for i := 0; i < MaxSearchEntries+1; i++ {
		if err := os.WriteFile(filepath.Join(dir, fmt.Sprintf("image-%05d.png", i)), nil, 0600); err != nil {
			t.Fatal(err)
		}
	}
	store, err := New(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	result, err := store.SearchContent(context.Background(), "", "absent")
	if err != nil || result.Limit != "entries" || result.FilesScanned != 0 || len(result.Matches) != 0 {
		t.Fatalf("entry limit: %+v %v", result, err)
	}
}
