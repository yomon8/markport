//go:build linux || darwin

package server

import (
	"context"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/markport/markport/internal/files"
	"golang.org/x/sys/unix"
)

func TestSpecialFilesDoNotBlockAPI(t *testing.T) {
	app, dir := newTestServer(t)
	for _, name := range []string{"pipe.md", "pipe.png"} {
		if err := unix.Mkfifo(filepath.Join(dir, name), 0600); err != nil {
			t.Fatal(err)
		}
	}
	for _, url := range []string{"/api/file?path=pipe.md", "/api/asset?path=pipe.png"} {
		result := make(chan int, 1)
		go func() { result <- request(app, "localhost:3000", url).Code }()
		select {
		case status := <-result:
			if status < 400 {
				t.Errorf("special accepted: %s %d", url, status)
			}
		case <-time.After(time.Second):
			t.Fatalf("blocked on %s", url)
		}
	}
	if err := os.WriteFile(filepath.Join(dir, "ok.md"), []byte("ok"), 0644); err != nil {
		t.Fatal(err)
	}
	if status := request(app, "localhost:3000", "/api/file?path=ok.md").Code; status != 200 {
		t.Errorf("after FIFO: %d", status)
	}
}

func TestStartupWatchErrorVisibleToLaterSSEClient(t *testing.T) {
	if os.Geteuid() == 0 {
		t.Skip("permission denial cannot be tested as root")
	}
	root := t.TempDir()
	blocked := filepath.Join(root, "blocked")
	if err := os.Mkdir(blocked, 0000); err != nil {
		t.Fatal(err)
	}
	defer os.Chmod(blocked, 0700)
	store, err := files.New(root)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	app, err := New(store, 3000)
	if err != nil {
		t.Fatal(err)
	}
	defer app.Close()
	watcher, err := files.NewWatcher(store, app.Publish)
	if err != nil {
		t.Fatal(err)
	}
	defer watcher.Close()
	ctx, cancel := context.WithCancel(context.Background())
	req := httptest.NewRequest("GET", "/api/events", nil).WithContext(ctx)
	req.Host = "localhost:3000"
	w := httptest.NewRecorder()
	done := make(chan struct{})
	go func() { app.ServeHTTP(w, req); close(done) }()
	time.Sleep(10 * time.Millisecond)
	cancel()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("SSE did not close")
	}
	if !strings.Contains(w.Body.String(), "event: watch-error") {
		t.Fatalf("missing startup watch error: %s", w.Body.String())
	}
	if err := os.Chmod(blocked, 0700); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		app.mu.Lock()
		failed := app.watchError
		app.mu.Unlock()
		if !failed {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("watch status did not recover after directory became readable")
}

func TestIntermediateLinkRejectedByBothAPIs(t *testing.T) {
	app, root := newTestServer(t)
	outside := t.TempDir()
	if err := os.WriteFile(filepath.Join(outside, "secret.md"), []byte("SECRET"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(outside, "secret.png"), []byte{0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n', 0, 0, 0, 0}, 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(root, "middle")); err != nil {
		t.Fatal(err)
	}
	for _, url := range []string{"/api/file?path=middle%2Fsecret.md", "/api/asset?path=middle%2Fsecret.png"} {
		r := request(app, "localhost:3000", url)
		if r.Code < 400 {
			t.Fatalf("intermediate link accepted: %s %d", url, r.Code)
		}
	}
}
