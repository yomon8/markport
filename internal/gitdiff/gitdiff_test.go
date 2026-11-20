package gitdiff

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"github.com/markport/markport/internal/files"
)

func TestListLineCounts(t *testing.T) {
	dir := t.TempDir()
	git := func(args ...string) {
		t.Helper()
		command := exec.Command("git", append([]string{"-C", dir}, args...)...)
		command.Env = append(os.Environ(), "GIT_CONFIG_NOSYSTEM=1", "GIT_CONFIG_GLOBAL="+os.DevNull)
		if output, err := command.CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v: %s", args, err, output)
		}
	}
	write := func(name, content string) {
		t.Helper()
		if err := os.WriteFile(filepath.Join(dir, name), []byte(content), 0600); err != nil {
			t.Fatal(err)
		}
	}
	git("init", "-q")
	git("config", "user.email", "test@example.com")
	git("config", "user.name", "Test")
	write("modified.txt", "same\nold\n+++content\n")
	write("deleted.txt", "first\nsecond\n")
	git("add", ".")
	git("commit", "-qm", "initial")
	write("modified.txt", "same\nnew\n+++content\n")
	write("added.txt", "first\nsecond\n")
	if err := os.Remove(filepath.Join(dir, "deleted.txt")); err != nil {
		t.Fatal(err)
	}
	store, err := files.New(dir)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := store.Close(); err != nil {
			t.Errorf("close store: %v", err)
		}
	})
	for run := 0; run < 2; run++ {
		listing, err := List(context.Background(), store)
		if err != nil {
			t.Fatal(err)
		}
		want := map[string][2]int{"modified.txt": {1, 1}, "added.txt": {2, 0}, "deleted.txt": {0, 2}}
		if len(listing.Changes) != len(want) {
			t.Fatalf("changes = %+v", listing.Changes)
		}
		for _, change := range listing.Changes {
			counts, ok := want[change.Path]
			if !ok || change.Added == nil || change.Deleted == nil || *change.Added != counts[0] || *change.Deleted != counts[1] {
				t.Errorf("%s counts: added=%v deleted=%v, want %v", change.Path, change.Added, change.Deleted, counts)
			}
		}
	}
}

func TestMyersLineCounts(t *testing.T) {
	cases := []struct {
		name             string
		oldText          string
		newText          string
		wantAdd, wantDel int
	}{
		{"identical", "a\nb\n", "a\nb\n", 0, 0},
		{"insert middle", "a\nc\n", "a\nb\nc\n", 1, 0},
		{"delete middle", "a\nb\nc\n", "a\nc\n", 0, 1},
		{"replace line", "a\nold\nc\n", "a\nnew\nc\n", 1, 1},
		{"trailing newline removed", "a\nb\n", "a\nb", 1, 1},
		{"empty to non-empty", "", "x\ny\n", 2, 0},
		{"non-empty to empty", "x\ny\n", "", 0, 2},
		{"crlf to lf", "a\r\nb\r\n", "a\nb\n", 2, 2},
	}
	for _, tc := range cases {
		added, deleted, ok := myersLineCounts(splitDiffLines(tc.oldText), splitDiffLines(tc.newText))
		if !ok || added != tc.wantAdd || deleted != tc.wantDel {
			t.Errorf("%s: got (%d, %d, %v), want (%d, %d, true)", tc.name, added, deleted, ok, tc.wantAdd, tc.wantDel)
		}
	}
}
