package server

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/markport/markport/internal/files"
)

func newTestServer(t *testing.T) (*Server, string) {
	t.Helper()
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "readme.md"), []byte("# Hello\n\n[code](code.py)"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "code.py"), []byte("print('hi')"), 0644); err != nil {
		t.Fatal(err)
	}
	s, err := files.New(dir)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	app, err := New(s, 3000)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(app.Close)
	return app, dir
}
func request(app *Server, host, url string) *httptest.ResponseRecorder {
	req := httptest.NewRequest("GET", url, nil)
	req.Host = host
	w := httptest.NewRecorder()
	app.ServeHTTP(w, req)
	return w
}
func TestHostAndAPI(t *testing.T) {
	app, _ := newTestServer(t)
	for _, host := range []string{"127.0.0.1:3000", "LOCALHOST:3000"} {
		for _, url := range []string{"/", "/api/tree", "/api/file?path=readme.md"} {
			r := request(app, host, url)
			if r.Code != 200 {
				t.Errorf("%s %s: %d", host, url, r.Code)
			}
		}
	}
	for _, host := range []string{"", "evil.test:3000", "x.localhost:3000", "localhost:3001", "localhost", "localhost:", "localhost:abc", "127.0.0.1:3000@evil.test", "[::1]:3000"} {
		r := request(app, host, "/api/tree")
		if r.Code != 400 {
			t.Errorf("host %q: %d", host, r.Code)
		}
	}
	req := httptest.NewRequest("GET", "/api/tree", nil)
	req.Host = "evil.test:3000"
	req.Header.Set("X-Forwarded-Host", "localhost:3000")
	forwarded := httptest.NewRecorder()
	app.ServeHTTP(forwarded, req)
	if forwarded.Code != 400 {
		t.Fatalf("forwarded host bypass: %d", forwarded.Code)
	}
	for _, url := range []string{"/api/file?path=..%2Fsecret", "/api/file?path=%2Fetc%2Fpasswd", "/api/asset?path=readme.md"} {
		r := request(app, "localhost:3000", url)
		if r.Code < 400 {
			t.Errorf("accepted %s: %d", url, r.Code)
		}
	}
	r := request(app, "localhost:3000", "/api/file?path=readme.md")
	if r.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Fatal("missing nosniff")
	}
	var file map[string]string
	if err := json.Unmarshal(r.Body.Bytes(), &file); err != nil {
		t.Fatal(err)
	}
	if file["type"] != "markdown" || !strings.Contains(file["html"], "/?path=code.py") {
		t.Fatalf("file: %+v", file)
	}
}

func TestDefaultHTTPPortHost(t *testing.T) {
	if !validHost("localhost", 80) || !validHost("LOCALHOST:80", 80) || validHost("localhost", 3000) {
		t.Fatal("port 80 host rules")
	}
}
func TestFileRejectionsAndSVG(t *testing.T) {
	app, dir := newTestServer(t)
	outside := t.TempDir()
	if err := os.WriteFile(filepath.Join(outside, "secret"), []byte("SECRET"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(outside, "secret.png"), []byte{0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n', 0, 0, 0, 0}, 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join(outside, "secret"), filepath.Join(dir, "link.md")); err == nil {
		for _, url := range []string{"/api/file?path=link.md", "/api/asset?path=link.md"} {
			r := request(app, "localhost:3000", url)
			if r.Code < 400 || strings.Contains(r.Body.String(), "SECRET") {
				t.Errorf("link accepted: %s", url)
			}
		}
	}
	if err := os.Symlink(filepath.Join(outside, "secret.png"), filepath.Join(dir, "link.png")); err == nil {
		r := request(app, "localhost:3000", "/api/asset?path=link.png")
		if r.Code < 400 || strings.Contains(r.Body.String(), "SECRET") {
			t.Fatalf("image link accepted: %d %s", r.Code, r.Body.String())
		}
	}
	if err := os.WriteFile(filepath.Join(dir, "huge.md"), []byte(strings.Repeat("x", files.MaxTextSize+1)), 0644); err != nil {
		t.Fatal(err)
	}
	if r := request(app, "localhost:3000", "/api/file?path=huge.md"); r.Code != 413 || !strings.Contains(r.Body.String(), "10 MiB") {
		t.Errorf("large file: %d %s", r.Code, r.Body.String())
	}
	if err := os.WriteFile(filepath.Join(dir, "binary.py"), []byte{0, 1, 2}, 0644); err != nil {
		t.Fatal(err)
	}
	if r := request(app, "localhost:3000", "/api/file?path=binary.py"); r.Code != 415 {
		t.Errorf("binary: %d", r.Code)
	}
	if err := os.WriteFile(filepath.Join(dir, "diagram.svg"), []byte(`<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`), 0644); err != nil {
		t.Fatal(err)
	}
	r := request(app, "localhost:3000", "/api/asset?path=diagram.svg")
	if r.Code != 200 || r.Header().Get("Content-Type") != "image/svg+xml" || !strings.Contains(r.Header().Get("Content-Security-Policy"), "script-src 'none'") {
		t.Fatalf("svg: %d %v", r.Code, r.Header())
	}
	if err := os.WriteFile(filepath.Join(dir, "spoof.svg"), []byte(`<html><svg xmlns="http://www.w3.org/2000/svg"></svg></html>`), 0644); err != nil {
		t.Fatal(err)
	}
	if r := request(app, "localhost:3000", "/api/asset?path=spoof.svg"); r.Code != 415 {
		t.Fatalf("HTML disguised as SVG: %d", r.Code)
	}
	if err := os.WriteFile(filepath.Join(dir, "broken.svg"), []byte(`<svg><g></svg>`), 0644); err != nil {
		t.Fatal(err)
	}
	if r := request(app, "localhost:3000", "/api/asset?path=broken.svg"); r.Code != 415 {
		t.Fatalf("malformed SVG: %d", r.Code)
	}
	if r := request(app, "localhost:3000", "/api/file?path=code.py"); r.Code != 200 {
		t.Errorf("after errors: %d", r.Code)
	}
}
func TestSSE(t *testing.T) {
	app, _ := newTestServer(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	req := httptest.NewRequest("GET", "/api/events", nil).WithContext(ctx)
	req.Host = "localhost:3000"
	w := httptest.NewRecorder()
	done := make(chan struct{})
	go func() { app.ServeHTTP(w, req); close(done) }()
	time.Sleep(20 * time.Millisecond)
	app.Publish("refresh")
	cancel()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("SSE did not exit")
	}
	if !strings.Contains(w.Body.String(), "event: ready") {
		t.Fatal("missing ready")
	}
	if r := request(app, "evil.test:3000", "/api/events"); r.Code != 400 {
		t.Errorf("SSE Host: %d", r.Code)
	}
}

func TestSSEReplaysCurrentWatchStatus(t *testing.T) {
	app, _ := newTestServer(t)
	capture := func() string {
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
		return w.Body.String()
	}
	app.Publish("watch-error")
	if body := capture(); !strings.Contains(body, "event: ready") || !strings.Contains(body, "event: watch-error") {
		t.Fatalf("missing persistent status: %s", body)
	}
	app.Publish("watch-ok")
	if body := capture(); strings.Contains(body, "event: watch-error") {
		t.Fatalf("stale error status: %s", body)
	}
}
