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

type fileHistoryFixture struct {
	dir    string
	store  *files.Store
	git    func(...string) string
	write  func(string, string)
	commit func(string) string
}

func newFileHistoryFixture(t *testing.T) fileHistoryFixture {
	t.Helper()
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("Git unavailable")
	}
	dir := t.TempDir()
	git := func(args ...string) string {
		t.Helper()
		cmd := exec.Command("git", append([]string{"-C", dir}, args...)...)
		cmd.Env = append(os.Environ(), "GIT_CONFIG_NOSYSTEM=1", "GIT_CONFIG_GLOBAL="+os.DevNull)
		data, err := cmd.CombinedOutput()
		if err != nil {
			t.Fatalf("git %v: %v: %s", args, err, data)
		}
		return strings.TrimSpace(string(data))
	}
	write := func(name, value string) {
		t.Helper()
		if err := os.MkdirAll(filepath.Dir(filepath.Join(dir, name)), 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, name), []byte(value), 0600); err != nil {
			t.Fatal(err)
		}
	}
	git("init", "-q")
	git("config", "user.name", "Test Author")
	git("config", "user.email", "test@example.com")
	git("config", "gc.auto", "0")
	git("config", "maintenance.auto", "false")
	commit := func(subject string) string {
		t.Helper()
		git("add", "-A")
		git("commit", "-qm", subject)
		return git("rev-parse", "HEAD")
	}
	store, err := files.New(dir)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	return fileHistoryFixture{dir, store, git, write, commit}
}

func TestFileHistoryRenameAndRevisions(t *testing.T) {
	f := newFileHistoryFixture(t)
	ctx := context.Background()
	f.write("old name 日本語.go", "package main\n// original\n")
	first := f.commit("original")
	f.git("mv", "old name 日本語.go", "new.go")
	renamed := f.commit("rename")
	f.write("other.go", "package other\n")
	f.commit("unrelated")
	f.write("new.go", "package main\n// modified\n")
	edited := f.commit("edit")
	page, err := FileHistory(ctx, f.store, "new.go", "", 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(page.Commits) != 3 || page.Commits[0].ID != edited || page.Commits[1].ID != renamed || page.Commits[1].Status != "renamed" || page.Commits[2].ID != first || page.Commits[2].Path != "old name 日本語.go" {
		t.Fatalf("history: %+v", page)
	}
	source, err := FileAtCommit(ctx, f.store, first, page.Commits[2].Path)
	if err != nil || source.Kind != "text" || source.Content != "package main\n// original\n" {
		t.Fatalf("source: %+v, %v", source, err)
	}
	diff, err := FileCommitDiff(ctx, f.store, renamed, "new.go")
	if err != nil || !strings.Contains(diff.Patch, "rename from") || strings.Contains(diff.Patch, "+package") {
		t.Fatalf("rename diff: %+v, %v", diff, err)
	}
	diff, err = FileCommitDiff(ctx, f.store, first, "old name 日本語.go")
	if err != nil || !strings.Contains(diff.Patch, "+package main") {
		t.Fatalf("root diff: %+v, %v", diff, err)
	}
	f.git("rm", "new.go")
	deleted := f.commit("delete")
	source, err = FileAtCommit(ctx, f.store, deleted, "new.go")
	if err != nil || source.Kind != "missing" {
		t.Fatalf("deleted source: %+v, %v", source, err)
	}
	diff, err = FileCommitDiff(ctx, f.store, deleted, "new.go")
	if err != nil || !strings.Contains(diff.Patch, "-package main") {
		t.Fatalf("delete diff: %+v, %v", diff, err)
	}
	if _, err := FileAtCommit(ctx, f.store, first, "../outside"); !errors.Is(err, files.ErrPath) {
		t.Fatalf("unsafe source: %v", err)
	}
	if _, err := FileAtCommit(ctx, f.store, strings.Repeat("f", 40), "new.go"); !errors.Is(err, ErrCommitNotFound) {
		t.Fatalf("unknown revision: %v", err)
	}
}

func TestFileHistoryRenameScopeBoundary(t *testing.T) {
	f := newFileHistoryFixture(t)
	ctx := context.Background()
	f.write("outside.go", "package main\n// private path\n")
	f.commit("outside")
	f.write("docs/keep.md", "keep\n")
	f.commit("docs")
	f.git("mv", "outside.go", "docs/inside.go")
	moved := f.commit("move inside")
	f.write("docs/inside.go", "package main\n// current\n")
	f.commit("inside edit")
	store, err := files.New(filepath.Join(f.dir, "docs"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	page, err := FileHistory(ctx, store, "inside.go", "", 0)
	if err != nil || len(page.Commits) != 2 || page.Commits[1].ID != moved {
		t.Fatalf("scope: %+v, %v", page, err)
	}
	diff, err := FileCommitDiff(ctx, store, moved, "inside.go")
	if err != nil || strings.Contains(diff.Patch, "outside.go") || !strings.Contains(diff.Patch, "+package main") {
		t.Fatalf("scope diff: %+v, %v", diff, err)
	}
	blame, err := Blame(ctx, store, "inside.go")
	if err != nil || len(blame.Lines) != 2 || blame.Lines[0].Path != "" {
		t.Fatalf("scope blame: %+v, %v", blame, err)
	}
}

func TestFileHistoryPagesAcrossRename(t *testing.T) {
	f := newFileHistoryFixture(t)
	ctx := context.Background()
	f.write("old.md", "initial\n")
	first := f.commit("initial")
	f.git("mv", "old.md", "new.md")
	f.commit("rename")
	for i := range 50 {
		f.write("new.md", strings.Repeat("line\n", i+2))
		f.commit("edit")
	}
	page, err := FileHistory(ctx, f.store, "new.md", "", 0)
	if err != nil || len(page.Commits) != 50 || page.NextOffset == nil {
		t.Fatalf("first page: %+v, %v", page, err)
	}
	next, err := FileHistory(ctx, f.store, "new.md", page.Head, *page.NextOffset)
	if err != nil || len(next.Commits) != 2 || next.NextOffset != nil || next.Commits[1].ID != first || next.Commits[1].Path != "old.md" {
		t.Fatalf("second page: %+v, %v", next, err)
	}
}

func TestBlameWorkingContentsAndIndexRename(t *testing.T) {
	f := newFileHistoryFixture(t)
	ctx := context.Background()
	f.write("日本語 old.go", "package main\n// original\n// stable\n")
	first := f.commit("original")
	f.write("日本語 old.go", "package main\n// staged\n// stable\n")
	f.git("add", ".")
	f.write("日本語 old.go", "package main\n// staged\n// unstaged\n")
	blame, err := Blame(ctx, f.store, "日本語 old.go")
	if err != nil {
		t.Fatal(err)
	}
	if len(blame.Lines) != 3 || blame.Lines[0].Commit != first || blame.Lines[0].Path != "日本語 old.go" || !blame.Lines[1].Uncommitted || !blame.Lines[2].Uncommitted || blame.Lines[2].Content != "// unstaged" {
		t.Fatalf("blame: %+v", blame)
	}
	f.git("mv", "日本語 old.go", "new.go")
	blame, err = Blame(ctx, f.store, "new.go")
	if err != nil || len(blame.Lines) != 3 || blame.Lines[0].Commit != first {
		t.Fatalf("index rename blame: %+v, %v", blame, err)
	}
	page, err := FileHistory(ctx, f.store, "new.go", "", 0)
	if err != nil || len(page.Commits) != 1 || page.Commits[0].Path != "日本語 old.go" {
		t.Fatalf("index rename history: %+v, %v", page, err)
	}
	f.write("empty.go", "")
	blame, err = Blame(ctx, f.store, "empty.go")
	if err != nil || len(blame.Lines) != 0 {
		t.Fatalf("empty: %+v, %v", blame, err)
	}
	f.write("new.md", "new\n\nlast")
	blame, err = Blame(ctx, f.store, "new.md")
	if err != nil || len(blame.Lines) != 3 || !blame.Lines[0].Uncommitted || blame.Lines[2].Content != "last" {
		t.Fatalf("new: %+v, %v", blame, err)
	}
	f.write("binary.bin", string([]byte{0, 1}))
	if _, err := Blame(ctx, f.store, "binary.bin"); !errors.Is(err, files.ErrBinary) {
		t.Fatalf("binary blame: %v", err)
	}
	binary := f.commit("binary")
	source, err := FileAtCommit(ctx, f.store, binary, "binary.bin")
	if err != nil || source.Kind != "binary" {
		t.Fatalf("binary source: %+v, %v", source, err)
	}
}

func TestFileHistoryMergeAndNonAncestor(t *testing.T) {
	f := newFileHistoryFixture(t)
	ctx := context.Background()
	f.write("a.go", "base\n")
	first := f.commit("base")
	branch := f.git("branch", "--show-current")
	f.git("checkout", "-qb", "side")
	f.write("a.go", "side\n")
	f.commit("side edit")
	f.git("checkout", branch)
	f.write("other.go", "other\n")
	f.commit("main edit")
	f.git("merge", "--no-ff", "-qm", "merge side", "side")
	merge := f.git("rev-parse", "HEAD")
	page, err := FileHistory(ctx, f.store, "a.go", "", 0)
	if err != nil || len(page.Commits) < 2 || page.Commits[0].ID != merge {
		t.Fatalf("merge history: %+v, %v", page, err)
	}
	diff, err := FileCommitDiff(ctx, f.store, merge, "a.go")
	if err != nil || !strings.Contains(diff.Patch, "-base") || !strings.Contains(diff.Patch, "+side") {
		t.Fatalf("merge diff: %+v, %v", diff, err)
	}
	f.git("checkout", "-qb", "unrelated", first)
	f.write("private.go", "private\n")
	unrelated := f.commit("private")
	f.git("checkout", branch)
	if _, err := FileAtCommit(ctx, f.store, unrelated, "private.go"); !errors.Is(err, ErrCommitNotFound) {
		t.Fatalf("nonancestor: %v", err)
	}
}

func TestBlameUnbornAndUnavailable(t *testing.T) {
	f := newFileHistoryFixture(t)
	ctx := context.Background()
	f.write("a.go", "first\n")
	blame, err := Blame(ctx, f.store, "a.go")
	if err != nil || !blame.Available || len(blame.Lines) != 1 || !blame.Lines[0].Uncommitted {
		t.Fatalf("unborn: %+v, %v", blame, err)
	}
	page, err := FileHistory(ctx, f.store, "a.go", "", 0)
	if err != nil || !page.Available || len(page.Commits) != 0 {
		t.Fatalf("unborn history: %+v, %v", page, err)
	}
	dir := t.TempDir()
	store, err := files.New(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	blame, err = Blame(ctx, store, "a.go")
	if err != nil || blame.Available || blame.Reason != "not_repository" {
		t.Fatalf("not repository: %+v, %v", blame, err)
	}
}

func TestFileGitRejectsLinks(t *testing.T) {
	f := newFileHistoryFixture(t)
	ctx := context.Background()
	f.write("regular.go", "regular\n")
	if err := os.Symlink("regular.go", filepath.Join(f.dir, "link.go")); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}
	id := f.commit("link")
	if _, err := FileAtCommit(ctx, f.store, id, "link.go"); !errors.Is(err, files.ErrType) {
		t.Fatalf("historical link: %v", err)
	}
	if _, err := FileCommitDiff(ctx, f.store, id, "link.go"); !errors.Is(err, files.ErrType) {
		t.Fatalf("link diff: %v", err)
	}
	if _, err := Blame(ctx, f.store, "link.go"); err == nil {
		t.Fatal("working link was accepted")
	}
}

func TestFileGitRejectsOversizedContents(t *testing.T) {
	f := newFileHistoryFixture(t)
	ctx := context.Background()
	f.write("large.go", strings.Repeat("x", files.MaxTextSize+1))
	id := f.commit("large")
	if _, err := Blame(ctx, f.store, "large.go"); !errors.Is(err, files.ErrTooLarge) {
		t.Fatalf("large working contents: %v", err)
	}
	if _, err := FileAtCommit(ctx, f.store, id, "large.go"); !errors.Is(err, ErrTooLarge) {
		t.Fatalf("large historical contents: %v", err)
	}
	if _, err := FileCommitDiff(ctx, f.store, id, "large.go"); !errors.Is(err, ErrTooLarge) {
		t.Fatalf("large diff: %v", err)
	}
}

func TestFileGitWithoutGit(t *testing.T) {
	f := newFileHistoryFixture(t)
	ctx := context.Background()
	t.Setenv("PATH", t.TempDir())
	page, err := FileHistory(ctx, f.store, "a.go", "", 0)
	if err != nil || page.Available || page.Reason != "git_unavailable" {
		t.Fatalf("history availability: %+v, %v", page, err)
	}
	blame, err := Blame(ctx, f.store, "a.go")
	if err != nil || blame.Available || blame.Reason != "git_unavailable" {
		t.Fatalf("blame availability: %+v, %v", blame, err)
	}
}

func TestBlameCRLFAndBlankLines(t *testing.T) {
	f := newFileHistoryFixture(t)
	ctx := context.Background()
	f.git("config", "core.autocrlf", "true")
	f.write("a.go", "package main\r\n\r\n// old\r\n")
	id := f.commit("CRLF")
	f.write("a.go", "package main\r\n\r\n// new\r\n")
	blame, err := Blame(ctx, f.store, "a.go")
	if err != nil || len(blame.Lines) != 3 || blame.Lines[0].Commit != id || !blame.Lines[2].Uncommitted {
		t.Fatalf("CRLF blame: %+v, %v", blame, err)
	}
}

func TestFileHistoryOmitsMergeWithoutFirstParentChanges(t *testing.T) {
	f := newFileHistoryFixture(t)
	f.write("a.go", "base\n")
	f.commit("base")
	branch := f.git("branch", "--show-current")
	f.git("checkout", "-qb", "side")
	f.write("a.go", "side\n")
	f.commit("side edit")
	f.git("checkout", branch)
	f.write("other.go", "main\n")
	f.commit("main edit")
	f.git("merge", "--no-ff", "-s", "ours", "-qm", "discard side changes", "side")
	merge := f.git("rev-parse", "HEAD")
	page, err := FileHistory(context.Background(), f.store, "a.go", "", 0)
	if err != nil {
		t.Fatal(err)
	}
	for _, commit := range page.Commits {
		if commit.ID == merge {
			t.Fatal("merge with no file changes appeared in the history")
		}
	}
}
