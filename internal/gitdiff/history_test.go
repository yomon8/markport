package gitdiff

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/markport/markport/internal/files"
)

func TestHistoryScopeAndCommitDiff(t *testing.T) {
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
	write := func(name string, data []byte) {
		t.Helper()
		if err := os.WriteFile(filepath.Join(dir, filepath.FromSlash(name)), data, 0600); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.Mkdir(filepath.Join(dir, "docs"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(filepath.Join(dir, "node_modules"), 0700); err != nil {
		t.Fatal(err)
	}
	git("init", "-q")
	git("config", "user.email", "test@example.com")
	git("config", "user.name", "Test")
	write("docs/a.md", []byte("old\n"))
	git("add", ".")
	git("commit", "-qm", "initial")
	initial := git("rev-parse", "HEAD")
	write("docs/a.md", []byte("new\n"))
	write("docs/b.bin", []byte{0, 1, 2})
	git("add", ".")
	git("commit", "-qm", "update docs")
	update := git("rev-parse", "HEAD")
	write("node_modules/private.txt", []byte("private\n"))
	git("add", "-f", "node_modules/private.txt")
	git("commit", "-qm", "excluded only")
	write("root.md", []byte("root\n"))
	git("add", ".")
	git("commit", "-qm", "root only")

	store, err := files.New(filepath.Join(dir, "docs"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	ctx := context.Background()
	page, err := History(ctx, store, "", 0)
	if err != nil {
		t.Fatal(err)
	}
	if !page.Available || len(page.Commits) != 2 || page.Commits[0].ID != update || page.Commits[1].ID != initial {
		t.Fatalf("scoped history: %+v", page)
	}
	detail, err := CommitInfo(ctx, store, update)
	if err != nil {
		t.Fatal(err)
	}
	if len(detail.Files) != 2 || detail.Files[0].Path != "a.md" || detail.Files[1].Path != "b.bin" {
		t.Fatalf("commit files: %+v", detail.Files)
	}
	diff, err := CommitFile(ctx, store, update, "a.md")
	if err != nil || diff.Kind != "text" || !strings.Contains(diff.Patch, "+new") {
		t.Fatalf("text diff: %+v, %v", diff, err)
	}
	diff, err = CommitFile(ctx, store, update, "b.bin")
	if err != nil || diff.Kind != "binary" {
		t.Fatalf("binary diff: %+v, %v", diff, err)
	}
	rootDiff, err := CommitFile(ctx, store, initial, "a.md")
	if err != nil || rootDiff.Kind != "text" || !strings.Contains(rootDiff.Patch, "+old") {
		t.Fatalf("root diff: %+v, %v", rootDiff, err)
	}
	if _, err := CommitInfo(ctx, store, git("rev-parse", "HEAD")); !errors.Is(err, ErrCommitNotFound) {
		t.Fatalf("out-of-scope commit: %v", err)
	}
	if _, err := CommitFile(ctx, store, update, "../root.md"); !errors.Is(err, os.ErrInvalid) {
		t.Fatalf("unsafe path: %v", err)
	}
}

func TestHistoryPages(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("Git is unavailable")
	}
	dir := t.TempDir()
	git := func(args ...string) {
		t.Helper()
		command := exec.Command("git", append([]string{"-C", dir}, args...)...)
		command.Env = append(os.Environ(), "GIT_CONFIG_NOSYSTEM=1", "GIT_CONFIG_GLOBAL="+os.DevNull)
		if output, err := command.CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v: %s", args, err, output)
		}
	}
	git("init", "-q")
	git("config", "user.email", "test@example.com")
	git("config", "user.name", "Test")
	for i := range 52 {
		if err := os.WriteFile(filepath.Join(dir, "page.md"), []byte(fmt.Sprintf("%d\n", i)), 0600); err != nil {
			t.Fatal(err)
		}
		git("add", ".")
		git("commit", "-qm", fmt.Sprintf("commit %d", i))
	}
	store, err := files.New(dir)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	first, err := History(context.Background(), store, "", 0)
	if err != nil || len(first.Commits) != 50 || first.NextOffset == nil || *first.NextOffset != 50 {
		t.Fatalf("first page: %+v, %v", first, err)
	}
	second, err := History(context.Background(), store, first.Head, *first.NextOffset)
	if err != nil || len(second.Commits) != 2 || second.NextOffset != nil || second.Commits[0].ID == first.Commits[49].ID {
		t.Fatalf("second page: %+v, %v", second, err)
	}
}

func TestHistoryMergeUsesFirstParent(t *testing.T) {
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
	write := func(name, content string) {
		t.Helper()
		if err := os.WriteFile(filepath.Join(dir, name), []byte(content), 0600); err != nil {
			t.Fatal(err)
		}
	}
	git("init", "-q")
	git("config", "user.email", "test@example.com")
	git("config", "user.name", "Test")
	write("a.md", "old\n")
	git("add", ".")
	git("commit", "-qm", "base")
	mainBranch := git("branch", "--show-current")
	git("checkout", "-qb", "feature")
	write("a.md", "feature\n")
	git("add", ".")
	git("commit", "-qm", "feature edit")
	git("checkout", "-q", mainBranch)
	write("other.md", "other\n")
	git("add", ".")
	git("commit", "-qm", "main edit")
	git("merge", "--no-ff", "-qm", "merge feature", "feature")
	mergeID := git("rev-parse", "HEAD")
	store, err := files.New(dir)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	ctx := context.Background()
	page, err := History(ctx, store, "", 0)
	if err != nil || len(page.Commits) == 0 || page.Commits[0].ID != mergeID {
		t.Fatalf("merge history: %+v, %v", page, err)
	}
	detail, err := CommitInfo(ctx, store, mergeID)
	if err != nil || len(detail.Files) != 1 || detail.Files[0].Path != "a.md" {
		t.Fatalf("merge files: %+v, %v", detail, err)
	}
	diff, err := CommitFile(ctx, store, mergeID, "a.md")
	if err != nil || !strings.Contains(diff.Patch, "+feature") || !strings.Contains(diff.Patch, "-old") {
		t.Fatalf("merge diff: %+v, %v", diff, err)
	}
}
