//go:build windows

package files

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

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
			if err := os.Rename(box, old); err != nil {
				done <- err
				return
			}
			if output, err := exec.Command("cmd", "/c", "mklink", "/J", box, outside).CombinedOutput(); err != nil {
				_ = os.Rename(old, box)
				done <- fmt.Errorf("mklink: %w: %s", err, output)
				return
			}
			if err := os.Remove(box); err != nil {
				done <- err
				return
			}
			if err := os.Rename(old, box); err != nil {
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
