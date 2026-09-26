package server

import (
	"context"
	"encoding/json"
	"image"
	"image/color"
	"image/png"
	"net/http"
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
	app, err := New(s, "127.0.0.1", 3000)
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

func TestContentSearchAPI(t *testing.T) {
	app, dir := newTestServer(t)
	if err := os.Mkdir(filepath.Join(dir, "docs"), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "docs", "guide.md"), []byte("above\nSearch target\nbelow\n"), 0644); err != nil {
		t.Fatal(err)
	}
	r := request(app, "localhost:3000", "/api/content-search?q=target&folder=docs")
	var result files.ContentSearch
	if r.Code != 200 || json.Unmarshal(r.Body.Bytes(), &result) != nil || len(result.Matches) != 1 || result.Matches[0].Line != 2 || result.Matches[0].Before != "above" || result.Matches[0].After != "below" {
		t.Fatalf("search: %d %s", r.Code, r.Body.String())
	}
	for _, url := range []string{"/api/content-search?folder=docs", "/api/content-search?q=", "/api/content-search?q=x&folder=..", "/api/content-search?q=x&folder=docs&folder=other"} {
		if got := request(app, "localhost:3000", url).Code; got != 400 {
			t.Errorf("%s: %d", url, got)
		}
	}
	if got := request(app, "localhost:3000", "/api/content-search?q=x&folder=missing").Code; got != 404 {
		t.Errorf("missing folder: %d", got)
	}
}
func TestHostAndAPI(t *testing.T) {
	app, _ := newTestServer(t)
	for _, host := range []string{"127.0.0.1:3000", "LOCALHOST:3000"} {
		for _, url := range []string{"/", "/api/tree", "/api/file?path=readme.md"} {
			r := request(app, host, url)
			if r.Code != 200 {
				t.Errorf("%s %s: %d", host, url, r.Code)
			}
			if len(r.Header().Get("X-Markport-Instance")) != 32 {
				t.Errorf("missing instance ID: %s %s", host, url)
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

func TestRenderPastedMarkdown(t *testing.T) {
	app, _ := newTestServer(t)
	post := func(body, contentType string) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(http.MethodPost, "/api/render", strings.NewReader(body))
		req.Host = "localhost:3000"
		req.Header.Set("Content-Type", contentType)
		response := httptest.NewRecorder()
		app.ServeHTTP(response, req)
		return response
	}
	good := post(`{"markdown":"# Preview\n\n[local](code.py)"}`, "application/json")
	var rendered map[string]string
	if err := json.Unmarshal(good.Body.Bytes(), &rendered); err != nil {
		t.Fatal(err)
	}
	if good.Code != http.StatusOK || !strings.Contains(rendered["html"], "<h1") || strings.Contains(rendered["html"], "/?path=") {
		t.Fatalf("render response: %d %s", good.Code, good.Body.String())
	}
	for _, test := range []struct {
		body, contentType string
		status            int
	}{
		{`{"markdown":`, "application/json", http.StatusBadRequest},
		{`{}`, "application/json", http.StatusBadRequest},
		{`{"markdown":"ok","unexpected":true}`, "application/json", http.StatusBadRequest},
		{`{"markdown":"ok"}{"markdown":"again"}`, "application/json", http.StatusBadRequest},
		{`{"markdown":"ok"}`, "text/plain", http.StatusUnsupportedMediaType},
		{`{"markdown":"` + strings.Repeat("a", maxPastedMarkdownSize+1) + `"}`, "application/json", http.StatusRequestEntityTooLarge},
		{strings.Repeat(" ", maxRenderRequestSize+1), "application/json", http.StatusRequestEntityTooLarge},
	} {
		got := post(test.body, test.contentType)
		if got.Code != test.status {
			t.Errorf("status %d for request length %d: %d %s", test.status, len(test.body), got.Code, got.Body.String())
		}
	}
	wrongMethod := request(app, "localhost:3000", "/api/render")
	if wrongMethod.Code != http.StatusMethodNotAllowed || wrongMethod.Header().Get("Allow") != "POST" {
		t.Fatalf("method: %d %s", wrongMethod.Code, wrongMethod.Header().Get("Allow"))
	}
}

func TestDefaultHTTPPortHost(t *testing.T) {
	if !validHost("localhost", "127.0.0.1", 80) || !validHost("LOCALHOST:80", "127.0.0.1", 80) || validHost("localhost", "127.0.0.1", 3000) {
		t.Fatal("port 80 host rules")
	}
}

func TestNetworkHost(t *testing.T) {
	app, _ := newTestServer(t)
	app.Host = "0.0.0.0"
	for _, host := range []string{"127.0.0.1:3000", "localhost:3000", "192.168.1.10:3000"} {
		if got := request(app, host, "/api/tree").Code; got != 200 {
			t.Errorf("wildcard host %q: %d", host, got)
		}
	}
	for _, host := range []string{"evil.test:3000", "192.168.1.10:3001", "192.168.1.10", "192.168.1.10:3000@evil.test", "[::1]:3000"} {
		if got := request(app, host, "/api/tree").Code; got != 400 {
			t.Errorf("rejected wildcard host %q: %d", host, got)
		}
	}
	app.Host = "192.168.1.10"
	if got := request(app, "192.168.1.10:3000", "/api/tree").Code; got != 200 {
		t.Errorf("specific host: %d", got)
	}
	for _, host := range []string{"127.0.0.1:3000", "localhost:3000", "192.168.1.11:3000"} {
		if got := request(app, host, "/api/tree").Code; got != 400 {
			t.Errorf("rejected specific host %q: %d", host, got)
		}
	}
}
func TestPagedTreeAndFileValidator(t *testing.T) {
	app, dir := newTestServer(t)
	if err := os.Mkdir(filepath.Join(dir, "docs"), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "docs", "page.md"), []byte("# Page"), 0644); err != nil {
		t.Fatal(err)
	}
	root := request(app, "localhost:3000", "/api/tree")
	var rootPage files.Page
	if err := json.Unmarshal(root.Body.Bytes(), &rootPage); err != nil {
		t.Fatal(err)
	}
	if len(rootPage.Entries) != 3 || rootPage.Entries[0].Name != "docs" || rootPage.Readme != "readme.md" {
		t.Fatalf("root listing: %+v", rootPage)
	}
	if root.Header().Get("ETag") == "" {
		t.Fatal("tree response missing validator")
	}
	treeRequest := httptest.NewRequest("GET", "/api/tree", nil)
	treeRequest.Host = "localhost:3000"
	treeRequest.Header.Set("If-None-Match", root.Header().Get("ETag"))
	treeResult := httptest.NewRecorder()
	app.ServeHTTP(treeResult, treeRequest)
	if treeResult.Code != http.StatusNotModified || treeResult.Body.Len() != 0 {
		t.Fatalf("unchanged tree: %d %s", treeResult.Code, treeResult.Body.String())
	}
	child := request(app, "localhost:3000", "/api/tree?path=docs&focus=page.md")
	var childPage files.Page
	if err := json.Unmarshal(child.Body.Bytes(), &childPage); err != nil || len(childPage.Entries) != 1 || childPage.Entries[0].Path != "docs/page.md" {
		t.Fatalf("child listing: %+v %v", childPage, err)
	}
	for _, target := range []string{"/api/tree?path=..", "/api/tree?offset=1", "/api/tree?focus=.."} {
		if got := request(app, "localhost:3000", target).Code; got != 400 {
			t.Errorf("%s: %d", target, got)
		}
	}
	first := request(app, "localhost:3000", "/api/file?path=readme.md")
	tag := first.Header().Get("ETag")
	if tag == "" {
		t.Fatal("file response missing validator")
	}
	req := httptest.NewRequest("GET", "/api/file?path=readme.md", nil)
	req.Host = "localhost:3000"
	req.Header.Set("If-None-Match", tag)
	w := httptest.NewRecorder()
	app.ServeHTTP(w, req)
	if w.Code != http.StatusNotModified || w.Body.Len() != 0 {
		t.Fatalf("unchanged file: %d %s", w.Code, w.Body.String())
	}
}

func TestSearchIndex(t *testing.T) {
	app, dir := newTestServer(t)
	if err := os.MkdirAll(filepath.Join(dir, "docs", "deep"), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "docs", "deep", "page.md"), []byte("# Page"), 0644); err != nil {
		t.Fatal(err)
	}
	response := request(app, "localhost:3000", "/api/search-index")
	if response.Code != http.StatusOK {
		t.Fatalf("search index: %d %s", response.Code, response.Body.String())
	}
	var body struct {
		Paths []string `json:"paths"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if strings.Join(body.Paths, ",") != "code.py,docs/deep/page.md,readme.md" {
		t.Fatalf("paths: %v", body.Paths)
	}
	tag := response.Header().Get("ETag")
	if tag == "" {
		t.Fatal("search index missing ETag")
	}
	conditional := httptest.NewRequest(http.MethodGet, "/api/search-index", nil)
	conditional.Host = "localhost:3000"
	conditional.Header.Set("If-None-Match", tag)
	revalidated := httptest.NewRecorder()
	app.ServeHTTP(revalidated, conditional)
	if revalidated.Code != http.StatusNotModified || revalidated.Body.Len() != 0 {
		t.Fatalf("conditional search: %d %s", revalidated.Code, revalidated.Body.String())
	}
	if err := os.WriteFile(filepath.Join(dir, "new.md"), []byte("new"), 0644); err != nil {
		t.Fatal(err)
	}
	cached := request(app, "localhost:3000", "/api/search-index")
	if strings.Contains(cached.Body.String(), "new.md") {
		t.Fatal("index cache was not reused")
	}
	forcedRequest := httptest.NewRequest(http.MethodGet, "/api/search-index", nil)
	forcedRequest.Host = "localhost:3000"
	forcedRequest.Header.Set("Cache-Control", "no-cache")
	forcedResponse := httptest.NewRecorder()
	app.ServeHTTP(forcedResponse, forcedRequest)
	if forcedResponse.Code != http.StatusOK || !strings.Contains(forcedResponse.Body.String(), "new.md") {
		t.Fatalf("no-cache search: %d %s", forcedResponse.Code, forcedResponse.Body.String())
	}
	forced := request(app, "localhost:3000", "/api/search-index?refresh=1")
	if forced.Code != http.StatusOK || !strings.Contains(forced.Body.String(), "new.md") || forced.Header().Get("ETag") == tag {
		t.Fatalf("forced search: %d %s", forced.Code, forced.Body.String())
	}
	if err := os.Remove(filepath.Join(dir, "new.md")); err != nil {
		t.Fatal(err)
	}
	removed := request(app, "localhost:3000", "/api/search-index?refresh=1")
	if strings.Contains(removed.Body.String(), "new.md") {
		t.Fatal("deleted file remained in refreshed index")
	}
	if err := os.WriteFile(filepath.Join(dir, "moved.md"), []byte("moved"), 0644); err != nil {
		t.Fatal(err)
	}
	app.Publish("refresh")
	updated := request(app, "localhost:3000", "/api/search-index")
	if updated.Code != http.StatusOK || !strings.Contains(updated.Body.String(), "moved.md") {
		t.Fatalf("watch invalidation: %d %s", updated.Code, updated.Body.String())
	}
}
func TestImageFilePreview(t *testing.T) {
	app, dir := newTestServer(t)
	imagePath := filepath.Join(dir, "sample image.png")
	f, err := os.Create(imagePath)
	if err != nil {
		t.Fatal(err)
	}
	img := image.NewRGBA(image.Rect(0, 0, 1, 1))
	img.Set(0, 0, color.RGBA{R: 255, A: 255})
	if err := png.Encode(f, img); err != nil {
		f.Close()
		t.Fatal(err)
	}
	if err := f.Close(); err != nil {
		t.Fatal(err)
	}
	read := func() string {
		t.Helper()
		r := request(app, "localhost:3000", "/api/file?path=sample+image.png")
		if r.Code != 200 {
			t.Fatalf("image metadata: %d %s", r.Code, r.Body.String())
		}
		var file map[string]string
		if err := json.Unmarshal(r.Body.Bytes(), &file); err != nil {
			t.Fatal(err)
		}
		if file["path"] != "sample image.png" || file["type"] != "image" || file["assetUrl"] == "" {
			t.Fatalf("image metadata: %+v", file)
		}
		return file["assetUrl"]
	}
	firstURL := read()
	asset := request(app, "localhost:3000", firstURL)
	if asset.Code != 200 || asset.Header().Get("Content-Type") != "image/png" {
		t.Fatalf("image asset: %d %v", asset.Code, asset.Header())
	}
	changed := time.Now().Add(time.Second)
	if err := os.Chtimes(imagePath, changed, changed); err != nil {
		t.Fatal(err)
	}
	if nextURL := read(); nextURL == firstURL {
		t.Fatal("image URL did not change after modification")
	}
	for _, ext := range []string{"svg", "jpg", "jpeg", "gif", "webp"} {
		name := "sample." + ext
		if err := os.WriteFile(filepath.Join(dir, name), []byte("placeholder"), 0644); err != nil {
			t.Fatal(err)
		}
		r := request(app, "localhost:3000", "/api/file?path="+name)
		if r.Code != 200 || !strings.Contains(r.Body.String(), `"type":"image"`) {
			t.Errorf("%s metadata: %d %s", ext, r.Code, r.Body.String())
		}
	}
	if r := request(app, "localhost:3000", "/api/file?path=missing.png"); r.Code != 404 {
		t.Fatalf("missing image: %d", r.Code)
	}
	largePath := filepath.Join(dir, "large.png")
	if err := os.WriteFile(largePath, nil, 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.Truncate(largePath, maxAssetSize+1); err != nil {
		t.Fatal(err)
	}
	if r := request(app, "localhost:3000", "/api/file?path=large.png"); r.Code != 413 || !strings.Contains(r.Body.String(), "32 MiB") {
		t.Fatalf("large image: %d %s", r.Code, r.Body.String())
	}
}

func TestHTMLPreview(t *testing.T) {
	app, dir := newTestServer(t)
	if err := os.Mkdir(filepath.Join(dir, "docs"), 0755); err != nil {
		t.Fatal(err)
	}
	for name, content := range map[string]string{
		"docs/page name.htm": `<!doctype html><html><head><link rel="stylesheet" href="style.css"></head><body><h1>Preview</h1><script>window.bad = true</script></body></html>`,
		"docs/style.css":     "h1 { color: red }",
		"docs/app.js":        "window.bad = true",
	} {
		if err := os.WriteFile(filepath.Join(dir, filepath.FromSlash(name)), []byte(content), 0644); err != nil {
			t.Fatal(err)
		}
	}
	r := request(app, "localhost:3000", "/api/file?path=docs%2Fpage+name.htm")
	if r.Code != 200 {
		t.Fatalf("metadata: %d %s", r.Code, r.Body.String())
	}
	var file map[string]string
	if err := json.Unmarshal(r.Body.Bytes(), &file); err != nil {
		t.Fatal(err)
	}
	if file["type"] != "html" || !strings.HasPrefix(file["previewUrl"], "/api/preview/docs/page%20name.htm?v=") {
		t.Fatalf("HTML metadata: %+v", file)
	}
	preview := request(app, "localhost:3000", file["previewUrl"])
	if preview.Code != 200 || preview.Header().Get("Content-Type") != "text/html; charset=utf-8" || !strings.Contains(preview.Body.String(), "<h1>Preview</h1>") {
		t.Fatalf("preview: %d %v %s", preview.Code, preview.Header(), preview.Body.String())
	}
	if csp := preview.Header().Get("Content-Security-Policy"); !strings.Contains(csp, "sandbox allow-same-origin") || !strings.Contains(csp, "script-src 'none'") {
		t.Fatalf("preview CSP: %q", csp)
	}
	if preview.Header().Get("Cache-Control") != "no-store" || preview.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Fatalf("preview headers: %v", preview.Header())
	}
	css := request(app, "localhost:3000", "/api/preview/docs/style.css")
	if css.Code != 200 || css.Header().Get("Content-Type") != "text/css; charset=utf-8" {
		t.Fatalf("CSS: %d %v", css.Code, css.Header())
	}
	source := request(app, "localhost:3000", "/api/file?path=docs%2Fpage+name.htm&source=1")
	if err := json.Unmarshal(source.Body.Bytes(), &file); err != nil || file["type"] != "html" || !strings.Contains(file["html"], "Preview") {
		t.Fatalf("source: %d %+v %v", source.Code, file, err)
	}
	if got := request(app, "localhost:3000", "/api/preview/docs/app.js").Code; got != http.StatusUnsupportedMediaType {
		t.Fatalf("ordinary preview served JavaScript: %d", got)
	}
	if csp := request(app, "localhost:3000", file["previewUrl"]+"&interactive=1").Header().Get("Content-Security-Policy"); !strings.Contains(csp, "script-src 'none'") {
		t.Fatalf("query enabled scripts in ordinary preview: %q", csp)
	}
	js := request(app, "localhost:3000", "/api/interactive/"+app.instance+"/docs/app.js")
	if js.Code != 200 || js.Header().Get("Content-Type") != "text/javascript; charset=utf-8" || js.Header().Get("Access-Control-Allow-Origin") != "*" {
		t.Fatalf("JavaScript: %d %v", js.Code, js.Header())
	}
	if got := request(app, "localhost:3000", "/api/interactive/wrong/docs/app.js").Code; got != http.StatusNotFound {
		t.Fatalf("untrusted interactive URL served JavaScript: %d", got)
	}
	interactive := request(app, "localhost:3000", strings.Replace(file["previewUrl"], "/api/preview/", "/api/interactive/"+app.instance+"/", 1))
	if csp := interactive.Header().Get("Content-Security-Policy"); interactive.Code != 200 || !strings.Contains(csp, "sandbox allow-scripts allow-modals") || strings.Contains(csp, "allow-same-origin") || !strings.Contains(interactive.Body.String(), "markportPreviewLink") {
		t.Fatalf("interactive preview: %d %v", interactive.Code, interactive.Header())
	}
	for _, path := range []string{"/api/preview/../readme.md", "/api/preview/docs/../../readme.md"} {
		if got := request(app, "localhost:3000", path).Code; got < 400 {
			t.Errorf("accepted %s: %d", path, got)
		}
	}
	if err := os.Symlink(filepath.Join(dir, "docs", "style.css"), filepath.Join(dir, "docs", "link.css")); err == nil {
		if got := request(app, "localhost:3000", "/api/preview/docs/link.css").Code; got < 400 {
			t.Errorf("accepted symlink: %d", got)
		}
	}
	if err := os.WriteFile(filepath.Join(dir, "docs", "binary.css"), []byte{0, 1, 2}, 0644); err != nil {
		t.Fatal(err)
	}
	if got := request(app, "localhost:3000", "/api/preview/docs/binary.css").Code; got != 415 {
		t.Errorf("binary CSS: %d", got)
	}
	large := filepath.Join(dir, "docs", "large.html")
	if err := os.WriteFile(large, nil, 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.Truncate(large, files.MaxTextSize+1); err != nil {
		t.Fatal(err)
	}
	if got := request(app, "localhost:3000", "/api/preview/docs/large.html").Code; got != 413 {
		t.Errorf("large HTML: %d", got)
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
		for _, url := range []string{"/api/file?path=link.png", "/api/asset?path=link.png"} {
			r := request(app, "localhost:3000", url)
			if r.Code < 400 || strings.Contains(r.Body.String(), "SECRET") {
				t.Fatalf("image link accepted: %d %s", r.Code, r.Body.String())
			}
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
