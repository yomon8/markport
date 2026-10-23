package server

import (
	"encoding/json"
	"io/fs"
	"strings"
	"testing"

	"github.com/markport/markport/internal/web"
)

func TestFileJSONDoesNotEscapeHTML(t *testing.T) {
	app, _ := newTestServer(t)
	response := request(app, "localhost:3000", "/api/file?path=readme.md")
	body := response.Body.String()
	if response.Code != 200 || strings.Contains(body, `\u003c`) || !strings.Contains(body, "<") || !json.Valid(response.Body.Bytes()) {
		t.Fatalf("JSON HTML: %d %s", response.Code, body)
	}
	if response.Header().Get("X-Content-Type-Options") != "nosniff" || !strings.HasPrefix(response.Header().Get("Content-Type"), "application/json") {
		t.Fatal(response.Header())
	}
}

func TestAssetCacheHeaders(t *testing.T) {
	app, _ := newTestServer(t)
	entries, err := fs.ReadDir(web.Dist, "dist/assets")
	if err != nil {
		t.Fatal(err)
	}
	name := ""
	for _, entry := range entries {
		if strings.HasSuffix(entry.Name(), ".js") {
			name = entry.Name()
			break
		}
	}
	if name == "" {
		t.Fatal("no built JavaScript asset")
	}
	for _, test := range []struct {
		path, cache string
		status      int
	}{
		{"/assets/" + name, "public, max-age=31536000, immutable", 200},
		{"/", "no-cache", 200},
		{"/assets/missing.js", "", 404},
		{"/api/events", "", 404},
	} {
		r := request(app, "localhost:3000", test.path)
		if r.Code != test.status || r.Header().Get("Cache-Control") != test.cache {
			t.Errorf("%s: status=%d cache=%q", test.path, r.Code, r.Header().Get("Cache-Control"))
		}
	}
}
