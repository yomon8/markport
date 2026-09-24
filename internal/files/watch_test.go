package files

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/fsnotify/fsnotify"
)

func awaitRefresh(t *testing.T, events <-chan string) {
	t.Helper()
	deadline := time.After(3 * time.Second)
	for {
		select {
		case name := <-events:
			if name == "refresh" || name == "created" || name == "changed" || name == "deleted" {
				return
			}
		case <-deadline:
			t.Fatal("watch refresh timeout")
		}
	}
}

func TestWatcherErrorRequestsRecovery(t *testing.T) {
	root := t.TempDir()
	s, err := New(root)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	w, err := fsnotify.NewWatcher()
	if err != nil {
		t.Fatal(err)
	}
	defer w.Close()
	var events []string
	v := &Watcher{store: s, w: w, watched: make(map[string]os.FileInfo), publish: func(name string) { events = append(events, name) }}
	if err := v.register(""); err != nil {
		t.Fatal(err)
	}
	v.handleError(errors.New("synthetic watcher failure"))
	if len(events) != 3 || events[0] != "watch-error" || events[1] != "watch-ok" || events[2] != "refresh" {
		t.Fatalf("events: %v", events)
	}
}

func TestWatcherMovedDescendants(t *testing.T) {
	root := t.TempDir()
	incoming := t.TempDir()
	if err := os.MkdirAll(filepath.Join(incoming, "folder", "child"), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(incoming, "folder", "child", "file.md"), []byte("before"), 0644); err != nil {
		t.Fatal(err)
	}
	s, err := New(root)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	events := make(chan string, 32)
	watcher, err := NewWatcher(s, func(name string) { events <- name })
	if err != nil {
		t.Fatal(err)
	}
	defer watcher.Close()
	if err := os.Rename(filepath.Join(incoming, "folder"), filepath.Join(root, "folder")); err != nil {
		t.Fatal(err)
	}
	awaitRefresh(t, events)
	if value, err := s.ReadText("folder/child/file.md"); err != nil || value != "before" {
		t.Fatalf("moved tree: %q %v", value, err)
	}
	if err := os.WriteFile(filepath.Join(root, "folder", "child", "file.md"), []byte("after"), 0644); err != nil {
		t.Fatal(err)
	}
	awaitRefresh(t, events)
	if err := os.Rename(filepath.Join(root, "folder"), filepath.Join(root, "renamed")); err != nil {
		t.Fatal(err)
	}
	awaitRefresh(t, events)
	if err := os.WriteFile(filepath.Join(root, "renamed", "child", "file.md"), []byte("again"), 0644); err != nil {
		t.Fatal(err)
	}
	awaitRefresh(t, events)
	if value, err := s.ReadText("renamed/child/file.md"); err != nil || value != "again" {
		t.Fatalf("renamed tree: %q %v", value, err)
	}
}

func TestWatcherDirectoryThenImmediateFile(t *testing.T) {
	root := t.TempDir()
	s, err := New(root)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	events := make(chan string, 16)
	watcher, err := NewWatcher(s, func(name string) { events <- name })
	if err != nil {
		t.Fatal(err)
	}
	defer watcher.Close()
	if err := os.Mkdir(filepath.Join(root, "new"), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "new", "now.md"), []byte("first"), 0644); err != nil {
		t.Fatal(err)
	}
	awaitRefresh(t, events)
	nodes, err := s.Tree()
	if err != nil {
		t.Fatal(err)
	}
	if len(nodes) != 1 || len(nodes[0].Children) != 1 {
		t.Fatalf("immediate file missing: %+v", nodes)
	}
	if err := os.WriteFile(filepath.Join(root, "new", "now.md"), []byte("changed"), 0644); err != nil {
		t.Fatal(err)
	}
	awaitRefresh(t, events)
}

func TestWatcherReplacedDirectory(t *testing.T) {
	root := t.TempDir()
	outside := t.TempDir()
	if err := os.Mkdir(filepath.Join(root, "same"), 0755); err != nil {
		t.Fatal(err)
	}
	s, err := New(root)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	events := make(chan string, 16)
	watcher, err := NewWatcher(s, func(name string) { events <- name })
	if err != nil {
		t.Fatal(err)
	}
	defer watcher.Close()
	if err := os.Rename(filepath.Join(root, "same"), filepath.Join(outside, "old")); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(filepath.Join(root, "same"), 0755); err != nil {
		t.Fatal(err)
	}
	awaitRefresh(t, events)
	if err := os.WriteFile(filepath.Join(root, "same", "fresh.md"), []byte("one"), 0644); err != nil {
		t.Fatal(err)
	}
	awaitRefresh(t, events)
}

func TestWatcherReportsDuringContinuousWrites(t *testing.T) {
	root := t.TempDir()
	file, err := os.OpenFile(filepath.Join(root, "active.md"), os.O_CREATE|os.O_RDWR, 0644)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	s, err := New(root)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	events := make(chan string, 16)
	w, err := NewWatcher(s, func(name string) { events <- name })
	if err != nil {
		t.Fatal(err)
	}
	defer w.Close()
	stop := make(chan struct{})
	done := make(chan struct{})
	go func() {
		defer close(done)
		ticker := time.NewTicker(10 * time.Millisecond)
		defer ticker.Stop()
		for {
			_, _ = file.WriteAt([]byte("x"), 0)
			select {
			case <-stop:
				return
			case <-ticker.C:
			}
		}
	}()
	select {
	case <-events:
	case <-time.After(time.Second):
		close(stop)
		<-done
		t.Fatal("continuous changes postponed all updates")
	}
	close(stop)
	<-done
}
