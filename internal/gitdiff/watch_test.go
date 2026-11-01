package gitdiff

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/markport/markport/internal/files"
)

func TestWatchDirsRepositoryAndWorktree(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("Git is unavailable")
	}
	root := t.TempDir()
	git := func(args ...string) {
		t.Helper()
		command := exec.Command("git", append([]string{"-C", root}, args...)...)
		command.Env = append(os.Environ(), "GIT_CONFIG_NOSYSTEM=1", "GIT_CONFIG_GLOBAL="+os.DevNull)
		if output, err := command.CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v: %s", args, err, output)
		}
	}
	git("init", "-q")
	git("-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "--allow-empty", "-qm", "initial")
	if err := os.Mkdir(filepath.Join(root, "docs"), 0755); err != nil {
		t.Fatal(err)
	}
	canonical, err := filepath.EvalSymlinks(root)
	if err != nil {
		t.Fatal(err)
	}
	for _, directory := range []string{root, filepath.Join(root, "docs")} {
		store, err := files.New(directory)
		if err != nil {
			t.Fatal(err)
		}
		dirs, err := WatchDirs(t.Context(), store)
		_ = store.Close()
		want := []string{filepath.Join(canonical, ".git"), filepath.Join(canonical, ".git", "refs", "heads")}
		if err != nil || !reflect.DeepEqual(dirs, want) {
			t.Fatalf("metadata for %s: %v, %v", directory, dirs, err)
		}
	}
	worktree := t.TempDir()
	git("worktree", "add", "-q", "-b", "watch-worktree", worktree, "HEAD")
	store, err := files.New(worktree)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	dirs, err := WatchDirs(t.Context(), store)
	want := []string{filepath.Join(canonical, ".git", "worktrees", filepath.Base(worktree)), filepath.Join(canonical, ".git", "refs", "heads")}
	if err != nil || !reflect.DeepEqual(dirs, want) {
		t.Fatalf("worktree metadata: %v, %v; want %v", dirs, err, want)
	}
}

func TestWatchDirsWithoutRepositoryAndCanceled(t *testing.T) {
	store, err := files.New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	if dirs, err := WatchDirs(t.Context(), store); err != nil || len(dirs) != 0 {
		t.Fatalf("non-repository: %v, %v", dirs, err)
	}
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	if _, err := WatchDirs(ctx, store); !errors.Is(err, context.Canceled) {
		t.Fatalf("canceled discovery: %v", err)
	}
}
