package gitdiff

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/markport/markport/internal/files"
)

func TestCompareCommitWithWorkingFiles(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("Git is unavailable")
	}
	dir := t.TempDir()
	git := func(args ...string) string {
		t.Helper()
		command := exec.Command("git", append([]string{"-C", dir}, args...)...)
		command.Env = append(os.Environ(), "GIT_CONFIG_NOSYSTEM=1", "GIT_CONFIG_GLOBAL="+os.DevNull)
		output, err := command.CombinedOutput()
		if err != nil {
			t.Fatalf("git %v: %v: %s", args, err, output)
		}
		return strings.TrimSpace(string(output))
	}
	write := func(name, value string) {
		t.Helper()
		if err := os.WriteFile(filepath.Join(dir, filepath.FromSlash(name)), []byte(value), 0600); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.Mkdir(filepath.Join(dir, "docs"), 0700); err != nil {
		t.Fatal(err)
	}
	git("init", "-q")
	git("config", "user.email", "test@example.com")
	git("config", "user.name", "Test")
	write("docs/a.md", "old\n")
	write("docs/deleted.md", "removed\n")
	write("root.md", "outside\n")
	write(".gitignore", "docs/ignored.md\n")
	git("add", ".")
	git("commit", "-qm", "base")
	base := git("rev-parse", "HEAD")
	write("docs/a.md", "committed\n")
	write("docs/added.md", "added in commit\n")
	git("add", ".")
	git("commit", "-qm", "second")
	currentBranch := git("branch", "--show-current")
	git("checkout", "-qb", "other", base)
	write("docs/other.md", "other branch\n")
	git("add", ".")
	git("commit", "-qm", "other branch")
	other := git("rev-parse", "HEAD")
	git("checkout", "-q", currentBranch)
	write("docs/a.md", "working\n")
	git("add", "docs/a.md")
	write("docs/untracked.md", "untracked\n")
	write("docs/ignored.md", "ignored\n")
	write("root.md", "changed outside\n")
	if err := os.Remove(filepath.Join(dir, "docs", "deleted.md")); err != nil {
		t.Fatal(err)
	}
	store, err := files.New(filepath.Join(dir, "docs"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	ctx := context.Background()
	listing, err := ListAt(ctx, store, base[:10])
	if err != nil {
		t.Fatal(err)
	}
	if listing.Base != base {
		t.Fatalf("base = %q, want %q", listing.Base, base)
	}
	want := map[string]string{"a.md": "modified", "added.md": "added", "deleted.md": "deleted", "untracked.md": "added"}
	if len(listing.Changes) != len(want) {
		t.Fatalf("changes = %+v", listing.Changes)
	}
	for _, change := range listing.Changes {
		if want[change.Path] != change.Status {
			t.Errorf("change = %+v", change)
		}
		staging := map[string]string{"a.md": "staged", "added.md": "clean", "deleted.md": "unstaged", "untracked.md": "untracked"}
		if change.Staging != staging[change.Path] {
			t.Errorf("comparison used historical staging: %+v", change)
		}
	}
	current, err := List(ctx, store)
	if err != nil {
		t.Fatal(err)
	}
	if current.RootID == listing.RootID || current.Base != "" {
		t.Fatalf("comparison shared review identity: %+v", current)
	}
	diff, err := FileAt(ctx, store, base[:10], "a.md")
	if err != nil || !strings.Contains(diff.Patch, "-old") || !strings.Contains(diff.Patch, "+working") {
		t.Fatalf("file diff = %+v, %v", diff, err)
	}
	for name, needle := range map[string]string{"added.md": "+added in commit", "untracked.md": "+untracked", "deleted.md": "-removed"} {
		diff, err := FileAt(ctx, store, base, name)
		if err != nil || !strings.Contains(diff.Patch, needle) {
			t.Errorf("%s diff = %+v, %v", name, diff, err)
		}
	}
	for _, name := range []string{"ignored.md", "../root.md", "root.md"} {
		if _, err := FileAt(ctx, store, base, name); err == nil {
			t.Errorf("unsafe or excluded file %s was compared", name)
		}
	}
	for _, invalid := range []string{"not-a-commit", "deadbee"} {
		if _, err := ListAt(ctx, store, invalid); !errors.Is(err, ErrCommitNotFound) {
			t.Errorf("invalid base %q: %v", invalid, err)
		}
	}
	if _, err := ListAt(ctx, store, other); !errors.Is(err, ErrCommitNotFound) {
		t.Errorf("commit on another branch: %v", err)
	}
}
