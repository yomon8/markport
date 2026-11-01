package server

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/markport/markport/internal/files"
)

func TestContentSearchIgnoredOrder(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("Git is unavailable")
	}
	app, dir := newTestServer(t)
	gitCommand(t, dir, "init", "-q")
	for name, text := range map[string]string{
		".gitignore": "a-generated.txt\n", "a-generated.txt": strings.Repeat("needle ignored\n", 110), "z-normal.txt": "needle visible",
	} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(text), 0644); err != nil {
			t.Fatal(err)
		}
	}
	w := request(app, "localhost:3000", "/api/content-search?q=needle")
	var result files.ContentSearch
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &result) != nil || len(result.Matches) != 1 || result.Matches[0].Path != "z-normal.txt" || result.IgnoredSkipped != 1 {
		t.Fatalf("default ignored filtering: %d %s", w.Code, w.Body.String())
	}
	w = request(app, "localhost:3000", "/api/content-search?q=needle&ignored=1")
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &result) != nil || len(result.Matches) != 100 || result.Matches[0].Path != "z-normal.txt" || result.IgnoredSkipped != 0 || result.Limit != "matches" {
		t.Fatalf("ignored deferred: %d %s", w.Code, w.Body.String())
	}
}

func TestContentSearchOptionsAndValidation(t *testing.T) {
	app, dir := newTestServer(t)
	if err := os.WriteFile(filepath.Join(dir, "search.txt"), []byte("BUG-123\nbug-2\nbug_3\n"), 0644); err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		query string
		count int
	}{
		{"q=bug&word=1", 2},
		{"q=bug&word=1&case=1", 1},
		{"q=bug-%5Cd%2B&regex=1&case=1&include=*.txt", 1},
		{"q=bug&include=*.txt&exclude=search.txt", 0},
	} {
		w := request(app, "localhost:3000", "/api/content-search?"+tc.query)
		var result files.ContentSearch
		if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &result) != nil || len(result.Matches) != tc.count {
			t.Errorf("%s: %d %s", tc.query, w.Code, w.Body.String())
		}
	}
	for _, key := range []string{"q", "folder", "case", "word", "regex", "include", "exclude", "ignored"} {
		query := "q=bug&" + key + "=1&" + key + "=1"
		if key == "q" {
			query = "q=bug&q=bug"
		}
		w := request(app, "localhost:3000", "/api/content-search?"+query)
		if w.Code != 400 || !strings.Contains(w.Body.String(), `"error":"invalid_path"`) {
			t.Errorf("duplicate %s: %d %s", key, w.Code, w.Body.String())
		}
	}
	for _, query := range []string{"q=%5B&regex=1", "q=bug&include=%5B", "q=bug&exclude=%5B", "q=bug&include=" + strings.Repeat("*.md,", 20) + "*.go"} {
		w := request(app, "localhost:3000", "/api/content-search?"+query)
		if w.Code != 400 || !strings.Contains(w.Body.String(), `"error":"invalid_query"`) {
			t.Errorf("invalid %s: %d %s", query, w.Code, w.Body.String())
		}
	}
}

func TestContentSearchWithoutGitAndTimeout(t *testing.T) {
	app, dir := newTestServer(t)
	for name, text := range map[string]string{".gitignore": "generated.txt\n", "generated.txt": "needle"} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(text), 0644); err != nil {
			t.Fatal(err)
		}
	}
	t.Setenv("PATH", t.TempDir())
	w := request(app, "localhost:3000", "/api/content-search?q=needle")
	var result files.ContentSearch
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &result) != nil || len(result.Matches) != 1 || result.IgnoredSkipped != 0 {
		t.Fatalf("without Git: %d %s", w.Code, w.Body.String())
	}
	ctx, cancel := context.WithDeadline(context.Background(), time.Now().Add(-time.Second))
	defer cancel()
	req := httptest.NewRequest("GET", "/api/content-search?q=needle", nil).WithContext(ctx)
	req.Host = "localhost:3000"
	w = httptest.NewRecorder()
	app.ServeHTTP(w, req)
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &result) != nil || result.Limit != "timeout" {
		t.Fatalf("timeout: %d %s", w.Code, w.Body.String())
	}
}

func TestContentSearchNewFolderAfterCachedIndex(t *testing.T) {
	app, dir := newTestServer(t)
	if w := request(app, "localhost:3000", "/api/search-index"); w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	if err := os.Mkdir(filepath.Join(dir, "new-folder"), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "new-folder", "a.md"), []byte("needle"), 0644); err != nil {
		t.Fatal(err)
	}
	w := request(app, "localhost:3000", "/api/content-search?q=needle&folder=new-folder")
	var result files.ContentSearch
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &result) != nil || len(result.Matches) != 1 {
		t.Fatalf("stale scoped index: %d %s", w.Code, w.Body.String())
	}
}

func TestDirectoryRefreshInvalidatesSearchCandidates(t *testing.T) {
	app, dir := newTestServer(t)
	for _, endpoint := range []string{"/api/tree", "/api/search-index"} {
		if w := request(app, "localhost:3000", endpoint); w.Code != 200 {
			t.Fatal(w.Body.String())
		}
	}
	if err := os.WriteFile(filepath.Join(dir, "new.md"), []byte("needle"), 0644); err != nil {
		t.Fatal(err)
	}
	if w := request(app, "localhost:3000", "/api/tree"); w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	w := request(app, "localhost:3000", "/api/content-search?q=needle")
	var result files.ContentSearch
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &result) != nil || len(result.Matches) != 1 || result.Matches[0].Path != "new.md" {
		t.Fatalf("stale candidates after directory refresh: %d %s", w.Code, w.Body.String())
	}
}
