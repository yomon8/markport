//go:build windows

package server

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestJunctionRejectedByBothAPIs(t *testing.T) {
	app, root := newTestServer(t)
	outside := t.TempDir()
	if err := os.WriteFile(filepath.Join(outside, "secret.md"), []byte("SECRET"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(outside, "secret.svg"), []byte(`<svg xmlns="http://www.w3.org/2000/svg"/>`), 0644); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(root, "junction")
	if output, err := exec.Command("cmd", "/c", "mklink", "/J", link, outside).CombinedOutput(); err != nil {
		t.Fatalf("mklink /J: %v: %s", err, output)
	}
	for _, url := range []string{"/api/file?path=junction%2Fsecret.md", "/api/file?path=junction%2Fsecret.svg", "/api/asset?path=junction%2Fsecret.svg"} {
		r := request(app, "localhost:3000", url)
		if r.Code < 400 || strings.Contains(r.Body.String(), "SECRET") {
			t.Fatalf("junction access: %s %d", url, r.Code)
		}
	}
}
