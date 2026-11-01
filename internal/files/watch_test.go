//go:build linux || windows

package files

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"sort"
	"sync"
	"testing"
	"time"

	"github.com/fsnotify/fsnotify"
)

func watchStore(t *testing.T) *Store {
	t.Helper()
	store, err := New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	return store
}

func startTestWatch(t *testing.T, store *Store, opts WatchOptions) *Watcher {
	t.Helper()
	watcher, err := store.Watch(t.Context(), opts)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = watcher.Close() })
	if watcher.Mode() != "watch" {
		t.Fatalf("mode = %s", watcher.Mode())
	}
	return watcher
}

func nextBatch(t *testing.T, changes <-chan ChangeBatch) ChangeBatch {
	t.Helper()
	select {
	case batch, ok := <-changes:
		if !ok {
			t.Fatal("subscription closed before a batch")
		}
		return batch
	case <-time.After(4 * time.Second):
		t.Fatal("timed out waiting for file changes")
		return ChangeBatch{}
	}
}

func quietWatch(t *testing.T, changes <-chan ChangeBatch) {
	t.Helper()
	select {
	case batch := <-changes:
		t.Fatalf("unexpected change: %+v", batch)
	case <-time.After(300 * time.Millisecond):
	}
}

func TestWatchBatchesRelativeChanges(t *testing.T) {
	store := watchStore(t)
	if err := os.Mkdir(filepath.Join(store.Path, "docs"), 0755); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"write.md", "remove.md", "rename.md"} {
		if err := os.WriteFile(filepath.Join(store.Path, "docs", name), []byte("before"), 0644); err != nil {
			t.Fatal(err)
		}
	}
	watcher := startTestWatch(t, store, WatchOptions{})
	changes, unsubscribe := watcher.Subscribe()
	defer unsubscribe()
	if err := os.WriteFile(filepath.Join(store.Path, "docs", "write.md"), []byte("after"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(store.Path, "docs", "created.md"), []byte("new"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(filepath.Join(store.Path, "docs", "remove.md")); err != nil {
		t.Fatal(err)
	}
	if err := os.Rename(filepath.Join(store.Path, "docs", "rename.md"), filepath.Join(store.Path, "docs", "renamed.md")); err != nil {
		t.Fatal(err)
	}
	batch := nextBatch(t, changes)
	want := []string{"docs/created.md", "docs/remove.md", "docs/rename.md", "docs/renamed.md", "docs/write.md"}
	if !reflect.DeepEqual(batch.Paths, want) || !batch.Created || batch.Git || batch.Overflow {
		t.Fatalf("batch = %+v", batch)
	}
	quietWatch(t, changes)
}

func TestWatchExcludesDirectoriesAndLinks(t *testing.T) {
	store := watchStore(t)
	for _, name := range []string{"node_modules", ".git", ".venv"} {
		if err := os.Mkdir(filepath.Join(store.Path, name), 0755); err != nil {
			t.Fatal(err)
		}
	}
	target := t.TempDir()
	if err := os.Symlink(target, filepath.Join(store.Path, "link")); err != nil && runtime.GOOS != "windows" {
		t.Fatal(err)
	}
	watcher := startTestWatch(t, store, WatchOptions{})
	changes, unsubscribe := watcher.Subscribe()
	defer unsubscribe()
	for _, name := range []string{"node_modules", ".git", ".venv"} {
		if err := os.WriteFile(filepath.Join(store.Path, name, "hidden.md"), []byte("hidden"), 0644); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(target, "outside.md"), []byte("outside"), 0644); err != nil {
		t.Fatal(err)
	}
	quietWatch(t, changes)
}

func TestWatchNewAndRenamedSubdirectories(t *testing.T) {
	store := watchStore(t)
	watcher := startTestWatch(t, store, WatchOptions{})
	changes, unsubscribe := watcher.Subscribe()
	defer unsubscribe()
	if err := os.MkdirAll(filepath.Join(store.Path, "sub", "deep"), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(store.Path, "sub", "deep", "a.md"), []byte("first"), 0644); err != nil {
		t.Fatal(err)
	}
	if batch := nextBatch(t, changes); !batch.Created {
		t.Fatalf("new directory: %+v", batch)
	}
	if err := os.WriteFile(filepath.Join(store.Path, "sub", "deep", "a.md"), []byte("second"), 0644); err != nil {
		t.Fatal(err)
	}
	if batch := nextBatch(t, changes); !reflect.DeepEqual(batch.Paths, []string{"sub/deep/a.md"}) {
		t.Fatalf("new subdirectory write: %+v", batch)
	}
	if err := os.Rename(filepath.Join(store.Path, "sub"), filepath.Join(store.Path, "moved")); err != nil {
		t.Fatal(err)
	}
	_ = nextBatch(t, changes)
	if err := os.WriteFile(filepath.Join(store.Path, "moved", "deep", "a.md"), []byte("third"), 0644); err != nil {
		t.Fatal(err)
	}
	if batch := nextBatch(t, changes); !reflect.DeepEqual(batch.Paths, []string{"moved/deep/a.md"}) {
		t.Fatalf("renamed subdirectory write: %+v", batch)
	}
	if err := os.RemoveAll(filepath.Join(store.Path, "moved")); err != nil {
		t.Fatal(err)
	}
	_ = nextBatch(t, changes)
	_ = watcher.Close()
	for directory := range watcher.directories {
		if directory != store.Path {
			t.Errorf("removed directory remains watched: %s", directory)
		}
	}
}

func TestWatchLimitsAndRegistrationFailure(t *testing.T) {
	store := watchStore(t)
	for _, name := range []string{"one", "two"} {
		if err := os.Mkdir(filepath.Join(store.Path, name), 0755); err != nil {
			t.Fatal(err)
		}
	}
	watcher, err := store.Watch(t.Context(), WatchOptions{MaxDirs: 2})
	if err == nil || watcher.Mode() != "poll" || len(watcher.native.WatchList()) != 0 {
		t.Fatalf("partial initial watch: %s, %v", watcher.Mode(), err)
	}
	_ = watcher.Close()
	watcher, err = store.Watch(t.Context(), WatchOptions{ExtraDirs: []string{filepath.Join(store.Path, "missing")}})
	if err == nil || watcher.Mode() != "poll" || len(watcher.native.WatchList()) != 0 {
		t.Fatalf("registration failure: %s, %v", watcher.Mode(), err)
	}
	_ = watcher.Close()
	store = watchStore(t)
	watcher = startTestWatch(t, store, WatchOptions{MaxDirs: 1})
	changes, unsubscribe := watcher.Subscribe()
	defer unsubscribe()
	if err := os.Mkdir(filepath.Join(store.Path, "new"), 0755); err != nil {
		t.Fatal(err)
	}
	if batch := nextBatch(t, changes); !batch.Overflow || watcher.Mode() != "poll" {
		t.Fatalf("partial runtime watch: %+v, %s", batch, watcher.Mode())
	}
	_ = watcher.Close()
	if len(watcher.native.WatchList()) != 0 {
		t.Fatal("runtime fallback retained watches")
	}
}

func TestWatchGitMetadataIsPrivateAndNonrecursive(t *testing.T) {
	store := watchStore(t)
	gitDir := filepath.Join(store.Path, ".git")
	if err := os.MkdirAll(filepath.Join(gitDir, "nested"), 0755); err != nil {
		t.Fatal(err)
	}
	watcher := startTestWatch(t, store, WatchOptions{ExtraDirs: []string{gitDir}})
	changes, unsubscribe := watcher.Subscribe()
	defer unsubscribe()
	if err := os.WriteFile(filepath.Join(gitDir, "index"), []byte("index"), 0644); err != nil {
		t.Fatal(err)
	}
	if batch := nextBatch(t, changes); !batch.Git || len(batch.Paths) != 0 || batch.Created {
		t.Fatalf("metadata leaked: %+v", batch)
	}
	if err := os.WriteFile(filepath.Join(gitDir, "nested", "private"), []byte("nested"), 0644); err != nil {
		t.Fatal(err)
	}
	quietWatch(t, changes)
}

func TestWatchOverflowAndPathCap(t *testing.T) {
	store := watchStore(t)
	watcher := startTestWatch(t, store, WatchOptions{Debounce: 500 * time.Millisecond})
	changes, unsubscribe := watcher.Subscribe()
	defer unsubscribe()
	for i := range MaxChangePaths + 10 {
		if err := os.WriteFile(filepath.Join(store.Path, fmt.Sprintf("%03d.md", i)), []byte("new"), 0644); err != nil {
			t.Fatal(err)
		}
	}
	batch := nextBatch(t, changes)
	if !batch.Overflow || len(batch.Paths) != MaxChangePaths || !sort.StringsAreSorted(batch.Paths) || watcher.Mode() != "watch" {
		t.Fatalf("path cap: %+v", batch)
	}
	watcher.native.Errors <- fsnotify.ErrEventOverflow
	if batch := nextBatch(t, changes); !batch.Overflow || watcher.Mode() != "poll" {
		t.Fatalf("kernel overflow: %+v", batch)
	}
}

func TestWatchSubscriptionsAndCancellation(t *testing.T) {
	store := watchStore(t)
	ctx, cancel := context.WithCancel(t.Context())
	watcher, err := store.Watch(ctx, WatchOptions{})
	if err != nil {
		t.Fatal(err)
	}
	defer watcher.Close()
	first, stopFirst := watcher.Subscribe()
	second, stopSecond := watcher.Subscribe()
	watcher.publish(ChangeBatch{Paths: []string{"a.md"}})
	batch := <-first
	batch.Paths[0] = "modified"
	if other := <-second; other.Paths[0] != "a.md" {
		t.Fatal("subscribers share mutable paths")
	}
	for range 10 {
		watcher.publish(ChangeBatch{Paths: []string{"latest.md"}})
	}
	if batch := <-first; !batch.Overflow {
		t.Fatal("slow subscriber lost changes without overflow")
	}
	stopFirst()
	stopFirst()
	stopSecond()
	var group sync.WaitGroup
	for range 30 {
		group.Go(func() {
			_, stop := watcher.Subscribe()
			watcher.publish(ChangeBatch{Paths: []string{"race.md"}})
			stop()
			stop()
		})
	}
	cancel()
	group.Wait()
	if err := watcher.Close(); err != nil && !errors.Is(err, os.ErrClosed) {
		t.Fatal(err)
	}
	closed, stop := watcher.Subscribe()
	defer stop()
	if _, ok := <-closed; ok {
		t.Fatal("subscription remained open after close")
	}
	if watcher.Mode() != "poll" {
		t.Fatal(watcher.Mode())
	}
}
