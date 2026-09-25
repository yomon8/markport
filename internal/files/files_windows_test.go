//go:build windows

package files

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"golang.org/x/sys/windows"
)

func renameWithRetry(old, new string) error {
	deadline := time.Now().Add(2 * time.Second)
	for {
		err := os.Rename(old, new)
		if err == nil || time.Now().After(deadline) || !errors.Is(err, windows.ERROR_ACCESS_DENIED) && !errors.Is(err, windows.ERROR_SHARING_VIOLATION) {
			return err
		}
		time.Sleep(time.Millisecond)
	}
}

func TestMissingFileReportsNotExist(t *testing.T) {
	s, err := New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	for _, name := range []string{"missing.md", "missing/file.md"} {
		if _, err := s.ReadText(name); !errors.Is(err, fs.ErrNotExist) {
			t.Errorf("%s: expected not exist, got %v", name, err)
		}
	}
}

func TestWatcherReportsNestedEditOnWindows(t *testing.T) {
	root := t.TempDir()
	child := filepath.Join(root, "child")
	if err := os.Mkdir(child, 0755); err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(child, "page.md")
	if err := os.WriteFile(file, []byte("before"), 0644); err != nil {
		t.Fatal(err)
	}
	s, err := New(root)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	events := make(chan string, 8)
	watcher, err := NewWatcher(s, func(event string) { events <- event })
	if err != nil {
		t.Fatal(err)
	}
	defer watcher.Close()
	if err := os.WriteFile(file, []byte("after"), 0644); err != nil {
		t.Fatal(err)
	}
	awaitRefresh(t, events)
}

func TestJunctionRejected(t *testing.T) {
	root := t.TempDir()
	outside := t.TempDir()
	if err := os.WriteFile(filepath.Join(outside, "secret.md"), []byte("SECRET"), 0644); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(root, "junction")
	if output, err := exec.Command("cmd", "/c", "mklink", "/J", link, outside).CombinedOutput(); err != nil {
		t.Fatalf("mklink /J: %v: %s", err, output)
	}
	s, err := New(root)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	if value, err := s.ReadText("junction/secret.md"); err == nil {
		t.Fatalf("junction read: %q", value)
	}
	nodes, err := s.Tree()
	if err != nil {
		t.Fatal(err)
	}
	if len(nodes) != 0 {
		t.Fatalf("junction in tree: %+v", nodes)
	}
	paths, err := s.FilePaths(context.Background())
	if err != nil || len(paths) != 0 {
		t.Fatalf("junction in file paths: %+v %v", paths, err)
	}
	page, err := s.List(context.Background(), "", 0, "")
	if err != nil || len(page.Entries) != 0 {
		t.Fatalf("junction in listing: %+v %v", page, err)
	}
}

func TestJunctionSwapNeverReadsTarget(t *testing.T) {
	root := t.TempDir()
	outside := t.TempDir()
	if err := os.WriteFile(filepath.Join(outside, "secret.md"), []byte("SECRET"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(filepath.Join(root, "box"), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "box", "secret.md"), []byte("safe"), 0644); err != nil {
		t.Fatal(err)
	}
	s, err := New(root)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	done := make(chan error, 1)
	go func() {
		for i := 0; i < 40; i++ {
			box := filepath.Join(root, "box")
			old := filepath.Join(root, "old")
			if err := renameWithRetry(box, old); err != nil {
				done <- err
				return
			}
			if output, err := exec.Command("cmd", "/c", "mklink", "/J", box, outside).CombinedOutput(); err != nil {
				_ = renameWithRetry(old, box)
				done <- fmt.Errorf("mklink: %w: %s", err, output)
				return
			}
			if err := os.Remove(box); err != nil {
				done <- err
				return
			}
			if err := renameWithRetry(old, box); err != nil {
				done <- err
				return
			}
		}
		done <- nil
	}()
	leaked := false
	deadline := time.After(20 * time.Second)
	for {
		select {
		case err := <-done:
			if err != nil {
				t.Fatal(err)
			}
			if leaked {
				t.Fatal("read junction target during replacement")
			}
			return
		case <-deadline:
			t.Fatal("junction swap test timed out")
		default:
			value, _ := s.ReadText("box/secret.md")
			if strings.Contains(value, "SECRET") {
				leaked = true
			}
			runtime.Gosched()
		}
	}
}

func TestWindowsPathAliasesRejected(t *testing.T) {
	for _, name := range []string{".GIT/config", "NODE_MODULES/a", "file.txt:stream", "name.", "name ", "C:/Windows", "NUL", "con.txt", "COM1.log", "lpt9", "CONOUT$", "COM¹", "NUL .txt"} {
		if _, err := Parts(name); err == nil {
			t.Errorf("accepted %q", name)
		}
	}
}
