//go:build linux || darwin

package files

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"golang.org/x/sys/unix"
)

func TestLinksAndFIFO(t *testing.T) {
	dir := t.TempDir()
	outside := t.TempDir()
	if err := os.WriteFile(filepath.Join(outside, "secret"), []byte("SECRET"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "inside"), []byte("ok"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink("inside", filepath.Join(dir, "internal-link")); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join(outside, "secret"), filepath.Join(dir, "external-link")); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(dir, "middle")); err != nil {
		t.Fatal(err)
	}
	if err := unix.Mkfifo(filepath.Join(dir, "pipe"), 0600); err != nil {
		t.Fatal(err)
	}
	s, err := New(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	for _, name := range []string{"internal-link", "external-link", "middle/secret", "pipe"} {
		ch := make(chan error, 1)
		go func() { _, e := s.ReadText(name); ch <- e }()
		select {
		case err := <-ch:
			if err == nil {
				t.Errorf("accepted %s", name)
			}
		case <-time.After(time.Second):
			t.Fatalf("blocked on %s", name)
		}
	}
	nodes, err := s.Tree()
	if err != nil {
		t.Fatal(err)
	}
	if len(nodes) != 1 || nodes[0].Name != "inside" {
		t.Fatalf("tree: %+v", nodes)
	}
	if v, err := s.ReadText("inside"); err != nil || v != "ok" {
		t.Fatalf("after rejection: %q %v", v, err)
	}
}

func TestSwapNeverReadsLinkTarget(t *testing.T) {
	if testing.Short() {
		t.Skip("race stress")
	}
	dir := t.TempDir()
	outside := t.TempDir()
	if err := os.WriteFile(filepath.Join(outside, "secret"), []byte("SECRET"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(filepath.Join(dir, "box"), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "box", "secret"), []byte("safe"), 0644); err != nil {
		t.Fatal(err)
	}
	s, err := New(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	stop := make(chan struct{})
	done := make(chan struct{})
	go func() {
		defer close(done)
		for {
			select {
			case <-stop:
				return
			default:
			}
			_ = os.Rename(filepath.Join(dir, "box"), filepath.Join(dir, "old"))
			_ = os.Symlink(outside, filepath.Join(dir, "box"))
			_ = os.Remove(filepath.Join(dir, "box"))
			_ = os.Rename(filepath.Join(dir, "old"), filepath.Join(dir, "box"))
		}
	}()
	for i := 0; i < 1000; i++ {
		v, _ := s.ReadText("box/secret")
		if strings.Contains(v, "SECRET") {
			t.Fatal("escaped root")
		}
		runtime.Gosched()
	}
	close(stop)
	<-done
}

func TestFinalSwapWithLinkAndFIFO(t *testing.T) {
	dir:=t.TempDir();outside:=t.TempDir()
	if err:=os.WriteFile(filepath.Join(outside,"secret"),[]byte("SECRET"),0644);err!=nil{t.Fatal(err)}
	if err:=os.WriteFile(filepath.Join(dir,"target.md"),[]byte("safe"),0644);err!=nil{t.Fatal(err)}
	s,err:=New(dir);if err!=nil{t.Fatal(err)};defer s.Close()
	stop:=make(chan struct{});done:=make(chan struct{})
	go func(){defer close(done);for {select{case <-stop:return;default:}
		_ = os.Rename(filepath.Join(dir,"target.md"),filepath.Join(dir,"old"))
		_ = os.Symlink(filepath.Join(outside,"secret"),filepath.Join(dir,"target.md"))
		_ = os.Remove(filepath.Join(dir,"target.md"))
		_ = unix.Mkfifo(filepath.Join(dir,"target.md"),0600)
		_ = os.Remove(filepath.Join(dir,"target.md"))
		_ = os.Rename(filepath.Join(dir,"old"),filepath.Join(dir,"target.md"))
	}}()
	result:=make(chan error,1)
	go func(){for i:=0;i<500;i++ {value,_:=s.ReadText("target.md");if strings.Contains(value,"SECRET"){result<-ErrPath;return}};result<-nil}()
	select{case err:=<-result:if err!=nil{t.Fatal("read link target")};case <-time.After(3*time.Second):t.Fatal("read blocked on swapped FIFO")}
	close(stop);<-done
}
