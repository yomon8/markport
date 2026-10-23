//go:build linux || darwin

package server

import (
	"os"
	"path/filepath"
	"testing"
	"time"

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
	for _, url := range []string{"/api/file?path=middle%2Fsecret.md", "/api/file?path=middle%2Fsecret.png", "/api/asset?path=middle%2Fsecret.png"} {
		r := request(app, "localhost:3000", url)
		if r.Code < 400 {
			t.Fatalf("intermediate link accepted: %s %d", url, r.Code)
		}
	}
}
