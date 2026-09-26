package server

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"mime"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"path"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/markport/markport/internal/files"
	"github.com/markport/markport/internal/gitdiff"
	"github.com/markport/markport/internal/render"
	"github.com/markport/markport/internal/web"
)

const (
	maxAssetSize          = 32 << 20
	maxPastedMarkdownSize = 1 << 20
	maxRenderRequestSize  = 8 << 20
)

var imageContentTypes = map[string]string{
	".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
	".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml",
}

func imageContentType(name string) (string, bool) {
	contentType, ok := imageContentTypes[strings.ToLower(path.Ext(name))]
	return contentType, ok
}

type Server struct {
	Files         *files.Store
	Host          string
	Port          int
	instance      string
	mu            sync.Mutex
	subs          map[chan string]struct{}
	closed        bool
	watchError    bool
	static        http.Handler
	searchMu      sync.Mutex
	searchPaths   []string
	searchExpires time.Time
	searchFlight  chan struct{}
	searchErr     error
}

func New(store *files.Store, host string, port int) (*Server, error) {
	dist, err := fs.Sub(web.Dist, "dist")
	if err != nil {
		return nil, err
	}
	instance := make([]byte, 16)
	if _, err := rand.Read(instance); err != nil {
		return nil, err
	}
	return &Server{Files: store, Host: host, Port: port, instance: hex.EncodeToString(instance), subs: make(map[chan string]struct{}), static: http.FileServer(http.FS(dist))}, nil
}

func (s *Server) Publish(event string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return
	}
	if event == "watch-error" {
		s.watchError = true
	}
	if event == "watch-ok" {
		s.watchError = false
	}
	if event == "refresh" {
		s.searchMu.Lock()
		s.searchExpires = time.Time{}
		s.searchMu.Unlock()
	}
	for ch := range s.subs {
		select {
		case ch <- event:
		default:
			<-ch
			ch <- event
		}
	}
}
func (s *Server) Close() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return
	}
	s.closed = true
	for ch := range s.subs {
		close(ch)
		delete(s.subs, ch)
	}
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("X-Content-Type-Options", "nosniff")
	if !validHost(r.Host, s.Host, s.Port) {
		http.Error(w, "invalid Host", http.StatusBadRequest)
		return
	}
	w.Header().Set("X-Markport-Instance", s.instance)
	if r.URL.Path == "/api/render" {
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", "POST")
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		s.render(w, r)
		return
	}
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", "GET")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	switch r.URL.Path {
	case "/api/tree":
		s.tree(w, r)
	case "/api/search-index":
		s.searchIndex(w, r)
	case "/api/content-search":
		s.contentSearch(w, r)
	case "/api/file":
		s.file(w, r)
	case "/api/asset":
		s.asset(w, r)
	case "/api/events":
		s.events(w, r)
	case "/api/git/changes":
		s.gitChanges(w, r)
	case "/api/git/diff":
		s.gitDiff(w, r)
	case "/":
		s.static.ServeHTTP(w, r)
	default:
		if strings.HasPrefix(r.URL.Path, "/api/preview/") || strings.HasPrefix(r.URL.Path, "/api/interactive/") {
			s.preview(w, r)
		} else if strings.HasPrefix(r.URL.Path, "/assets/") {
			s.static.ServeHTTP(w, r)
		} else {
			http.NotFound(w, r)
		}
	}
}

func (s *Server) render(w http.ResponseWriter, r *http.Request) {
	mediaType, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || mediaType != "application/json" {
		jsonReply(w, http.StatusUnsupportedMediaType, map[string]string{"error": "unsupported_media_type", "message": "Content-Type must be application/json"})
		return
	}
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxRenderRequestSize))
	decoder.DisallowUnknownFields()
	var input struct {
		Markdown *string `json:"markdown"`
	}
	if err := decoder.Decode(&input); err != nil {
		renderInputError(w, err)
		return
	}
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		if err == nil {
			err = errors.New("only one JSON object is allowed")
		}
		renderInputError(w, err)
		return
	}
	if input.Markdown == nil {
		jsonReply(w, http.StatusBadRequest, map[string]string{"error": "invalid_input", "message": "markdown is required"})
		return
	}
	if len(*input.Markdown) > maxPastedMarkdownSize {
		jsonReply(w, http.StatusRequestEntityTooLarge, map[string]string{"error": "too_large", "message": "Markdown exceeds the 1 MiB limit"})
		return
	}
	output, err := render.PastedMarkdown(*input.Markdown)
	if err != nil {
		jsonReply(w, http.StatusInternalServerError, map[string]string{"error": "render_failed", "message": "Cannot render Markdown"})
		return
	}
	jsonReply(w, http.StatusOK, map[string]string{"html": output})
}

func renderInputError(w http.ResponseWriter, err error) {
	var tooLarge *http.MaxBytesError
	if errors.As(err, &tooLarge) {
		jsonReply(w, http.StatusRequestEntityTooLarge, map[string]string{"error": "too_large", "message": "Request body is too large"})
		return
	}
	jsonReply(w, http.StatusBadRequest, map[string]string{"error": "invalid_input", "message": "Invalid JSON request"})
}

func validHost(raw, bindHost string, port int) bool {
	if raw == "" || strings.ContainsAny(raw, " \t\r\n/@\\") {
		return false
	}
	host, p, err := net.SplitHostPort(raw)
	if err != nil {
		if strings.Contains(raw, ":") {
			return false
		}
		host, p = raw, "80"
	}
	n, err := strconv.Atoi(p)
	if err != nil || n != port || p == "" {
		return false
	}
	if strings.EqualFold(host, "localhost") {
		return bindHost == "127.0.0.1" || bindHost == "0.0.0.0"
	}
	addr, err := netip.ParseAddr(host)
	if err != nil || !addr.Is4() {
		return false
	}
	return bindHost == "0.0.0.0" || addr.String() == bindHost
}

func jsonReply(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
func apiError(w http.ResponseWriter, err error) {
	status, code := http.StatusForbidden, "unreadable"
	switch {
	case errors.Is(err, fs.ErrNotExist):
		status, code = 404, "not_found"
	case errors.Is(err, files.ErrPath):
		status, code = 400, "invalid_path"
	case errors.Is(err, files.ErrBinary):
		status, code = 415, "binary"
	case errors.Is(err, files.ErrTooLarge):
		status, code = 413, "too_large"
	case errors.Is(err, files.ErrType):
		status, code = 403, "not_regular"
	}
	jsonReply(w, status, map[string]string{"error": code, "message": err.Error()})
}
func queryPath(r *http.Request) (string, error) {
	values, ok := r.URL.Query()["path"]
	if !ok || len(values) != 1 {
		return "", files.ErrPath
	}
	if _, err := files.Parts(values[0]); err != nil {
		return "", err
	}
	return values[0], nil
}

func gitError(w http.ResponseWriter, err error) {
	if errors.Is(err, gitdiff.ErrNoChange) {
		jsonReply(w, http.StatusNotFound, map[string]string{"error": "no_change", "message": err.Error()})
		return
	}
	if errors.Is(err, gitdiff.ErrUnavailable) {
		jsonReply(w, http.StatusServiceUnavailable, map[string]string{"error": "git_unavailable", "message": err.Error()})
		return
	}
	if errors.Is(err, gitdiff.ErrTooLarge) {
		apiError(w, files.ErrTooLarge)
		return
	}
	if errors.Is(err, files.ErrPath) || errors.Is(err, files.ErrType) || errors.Is(err, files.ErrBinary) || errors.Is(err, files.ErrTooLarge) || errors.Is(err, fs.ErrNotExist) {
		apiError(w, err)
		return
	}
	status := http.StatusServiceUnavailable
	if errors.Is(err, context.DeadlineExceeded) {
		status = http.StatusGatewayTimeout
	}
	jsonReply(w, status, map[string]string{"error": "git_failure", "message": err.Error()})
}

func gitTag(value any) string {
	data, _ := json.Marshal(value)
	return fmt.Sprintf("\"%x\"", sha256.Sum256(data))
}

func gitReply(w http.ResponseWriter, r *http.Request, value any) {
	tag := gitTag(value)
	w.Header().Set("ETag", tag)
	if r.Header.Get("If-None-Match") == tag {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	jsonReply(w, http.StatusOK, value)
}

func (s *Server) gitChanges(w http.ResponseWriter, r *http.Request) {
	listing, err := gitdiff.List(r.Context(), s.Files)
	if err != nil {
		gitError(w, err)
		return
	}
	gitReply(w, r, listing)
}

func (s *Server) gitDiff(w http.ResponseWriter, r *http.Request) {
	name, err := queryPath(r)
	if err != nil {
		apiError(w, err)
		return
	}
	diff, err := gitdiff.File(r.Context(), s.Files, name)
	if err != nil {
		gitError(w, err)
		return
	}
	gitReply(w, r, diff)
}
func (s *Server) searchIndex(w http.ResponseWriter, r *http.Request) {
	force := r.URL.Query().Get("refresh") == "1" || r.Header.Get("Cache-Control") == "no-cache"
	paths, err := s.cachedSearchPaths(r.Context(), force)
	if err != nil {
		apiError(w, err)
		return
	}
	hash := sha256.New()
	for _, name := range paths {
		_, _ = io.WriteString(hash, name+"\x00")
	}
	tag := `"` + hex.EncodeToString(hash.Sum(nil)) + `"`
	w.Header().Set("ETag", tag)
	if r.Header.Get("If-None-Match") == tag {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	jsonReply(w, http.StatusOK, struct {
		Paths []string `json:"paths"`
	}{Paths: paths})
}

// A short cache bounds full-tree walks during search; a forced refresh bypasses
// it. Concurrent requests share the same walk, including forced requests.
func (s *Server) cachedSearchPaths(ctx context.Context, force bool) ([]string, error) {
	for {
		s.searchMu.Lock()
		if !force && s.searchPaths != nil && time.Now().Before(s.searchExpires) {
			paths := s.searchPaths
			s.searchMu.Unlock()
			return paths, nil
		}
		if flight := s.searchFlight; flight != nil {
			s.searchMu.Unlock()
			select {
			case <-ctx.Done():
				return nil, ctx.Err()
			case <-flight:
			}
			s.searchMu.Lock()
			paths, err := s.searchPaths, s.searchErr
			s.searchMu.Unlock()
			return paths, err
		}
		flight := make(chan struct{})
		s.searchFlight = flight
		s.searchMu.Unlock()
		walkCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		paths, err := s.Files.FilePaths(walkCtx)
		cancel()
		s.searchMu.Lock()
		if err == nil {
			s.searchPaths = paths
			s.searchExpires = time.Now().Add(5 * time.Second)
		}
		s.searchErr = err
		s.searchFlight = nil
		close(flight)
		s.searchMu.Unlock()
		return paths, err
	}
}

func (s *Server) contentSearch(w http.ResponseWriter, r *http.Request) {
	queries := r.URL.Query()["q"]
	folders := r.URL.Query()["folder"]
	if len(queries) != 1 || len(folders) > 1 {
		apiError(w, files.ErrPath)
		return
	}
	folder := ""
	if len(folders) == 1 {
		folder = folders[0]
	}
	result, err := s.Files.SearchContent(r.Context(), folder, queries[0])
	if err != nil {
		if !errors.Is(err, context.Canceled) {
			apiError(w, err)
		}
		return
	}
	jsonReply(w, http.StatusOK, result)
}

func (s *Server) tree(w http.ResponseWriter, r *http.Request) {
	paths := r.URL.Query()["path"]
	if len(paths) > 1 {
		apiError(w, files.ErrPath)
		return
	}
	dir := r.URL.Query().Get("path")
	if dir != "" {
		if _, err := files.Parts(dir); err != nil {
			apiError(w, err)
			return
		}
	}
	offset := 0
	if values, ok := r.URL.Query()["offset"]; ok {
		if len(values) != 1 {
			apiError(w, files.ErrPath)
			return
		}
		var err error
		offset, err = strconv.Atoi(values[0])
		if err != nil {
			apiError(w, files.ErrPath)
			return
		}
	}
	focus := r.URL.Query().Get("focus")
	if len(r.URL.Query()["focus"]) > 1 {
		apiError(w, files.ErrPath)
		return
	}
	info, err := s.Files.DirectoryVersion(dir)
	if err != nil {
		apiError(w, err)
		return
	}
	version := fileVersion(info, false)
	w.Header().Set("ETag", version)
	if focus == "" && offset == 0 && r.Header.Get("If-None-Match") == version {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	page, err := s.Files.List(r.Context(), dir, offset, focus)
	if err != nil {
		apiError(w, err)
		return
	}
	jsonReply(w, 200, page)
}
func (s *Server) file(w http.ResponseWriter, r *http.Request) {
	name, err := queryPath(r)
	if err != nil {
		apiError(w, err)
		return
	}
	if _, ok := imageContentType(name); ok {
		f, err := s.Files.Open(name)
		if err != nil {
			apiError(w, err)
			return
		}
		info, err := f.Stat()
		_ = f.Close()
		if err != nil {
			apiError(w, err)
			return
		}
		if !info.Mode().IsRegular() {
			apiError(w, files.ErrType)
			return
		}
		if info.Size() > maxAssetSize {
			apiError(w, fmt.Errorf("%w: 32 MiB limit (actual %.1f MiB)", files.ErrTooLarge, float64(info.Size())/(1<<20)))
			return
		}
		version := fileVersion(info, false)
		w.Header().Set("ETag", version)
		if r.Header.Get("If-None-Match") == version {
			w.WriteHeader(http.StatusNotModified)
			return
		}
		assetURL := "/api/asset?path=" + url.QueryEscape(name) + "&v=" + strconv.FormatInt(info.ModTime().UnixNano(), 10) + "-" + strconv.FormatInt(info.Size(), 10)
		jsonReply(w, 200, map[string]string{"path": name, "type": "image", "assetUrl": assetURL})
		return
	}
	f, err := s.Files.Open(name)
	if err != nil {
		apiError(w, err)
		return
	}
	info, err := f.Stat()
	_ = f.Close()
	if err != nil {
		apiError(w, err)
		return
	}
	if info.Size() > files.MaxTextSize {
		apiError(w, fmt.Errorf("%w: 10 MiB limit (actual %.1f MiB)", files.ErrTooLarge, float64(info.Size())/(1<<20)))
		return
	}
	source := r.URL.Query().Get("source") == "1"
	version := fileVersion(info, source)
	w.Header().Set("ETag", version)
	if r.Header.Get("If-None-Match") == version {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	content, err := s.Files.ReadText(name)
	if err != nil {
		apiError(w, err)
		return
	}
	ext := strings.ToLower(path.Ext(name))
	markdown := ext == ".md" || ext == ".markdown"
	htmlFile := ext == ".html" || ext == ".htm"
	if htmlFile && !source {
		previewURL := "/api/preview/" + escapedPath(name) + "?v=" + strconv.FormatInt(info.ModTime().UnixNano(), 10) + "-" + strconv.FormatInt(info.Size(), 10)
		jsonReply(w, 200, map[string]string{"path": name, "type": "html", "previewUrl": previewURL})
		return
	}
	kind, output := "code", ""
	if source {
		if markdown {
			kind = "markdown"
		} else if htmlFile {
			kind = "html"
		}
		output = render.Code(name, content)
	} else if markdown {
		kind = "markdown"
		output, err = render.Markdown(name, content)
		if err != nil {
			apiError(w, err)
			return
		}
	} else {
		output = render.Code(name, content)
	}
	jsonReply(w, 200, map[string]string{"path": name, "type": kind, "html": output})
}

func escapedPath(name string) string {
	parts := strings.Split(name, "/")
	for i, part := range parts {
		parts[i] = url.PathEscape(part)
	}
	return strings.Join(parts, "/")
}

func fileVersion(info fs.FileInfo, source bool) string {
	return fmt.Sprintf("W/\"%d-%d-%t\"", info.ModTime().UnixNano(), info.Size(), source)
}
func (s *Server) asset(w http.ResponseWriter, r *http.Request) {
	name, err := queryPath(r)
	if err != nil {
		apiError(w, err)
		return
	}
	typeName, ok := imageContentType(name)
	if !ok {
		jsonReply(w, 415, map[string]string{"error": "unsupported_asset"})
		return
	}
	s.serveImage(w, name, typeName)
}

func (s *Server) serveImage(w http.ResponseWriter, name, typeName string) {
	b, err := s.Files.Read(name, maxAssetSize)
	if err != nil {
		apiError(w, err)
		return
	}
	if typeName != "image/svg+xml" && http.DetectContentType(b) != typeName {
		jsonReply(w, 415, map[string]string{"error": "invalid_asset"})
		return
	}
	if typeName == "image/svg+xml" && !validSVG(b) {
		jsonReply(w, 415, map[string]string{"error": "invalid_asset"})
		return
	}
	w.Header().Set("Content-Type", typeName)
	if typeName == "image/svg+xml" {
		w.Header().Set("Content-Security-Policy", "default-src 'none'; script-src 'none'; sandbox")
	}
	w.WriteHeader(200)
	_, _ = w.Write(b)
}

func (s *Server) preview(w http.ResponseWriter, r *http.Request) {
	interactive := strings.HasPrefix(r.URL.Path, "/api/interactive/")
	name := strings.TrimPrefix(r.URL.Path, "/api/preview/")
	if interactive {
		var token string
		token, name, _ = strings.Cut(strings.TrimPrefix(r.URL.Path, "/api/interactive/"), "/")
		if token != s.instance {
			http.NotFound(w, r)
			return
		}
	}
	if _, err := files.Parts(name); err != nil {
		apiError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Referrer-Policy", "no-referrer")
	if typeName, ok := imageContentType(name); ok {
		s.serveImage(w, name, typeName)
		return
	}
	ext := strings.ToLower(path.Ext(name))
	if ext != ".html" && ext != ".htm" && ext != ".css" && (!interactive || ext != ".js" && ext != ".mjs") {
		jsonReply(w, http.StatusUnsupportedMediaType, map[string]string{"error": "unsupported_asset"})
		return
	}
	content, err := s.Files.ReadText(name)
	if err != nil {
		apiError(w, err)
		return
	}
	if ext == ".css" {
		w.Header().Set("Content-Type", "text/css; charset=utf-8")
	} else if ext == ".js" || ext == ".mjs" {
		w.Header().Set("Content-Type", "text/javascript; charset=utf-8")
		w.Header().Set("Access-Control-Allow-Origin", "*")
	} else {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		if interactive {
			w.Header().Set("Content-Security-Policy", "sandbox allow-scripts allow-modals; script-src 'unsafe-inline' http://"+r.Host+"/api/interactive/"+s.instance+"/; connect-src 'none'; worker-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'; frame-src 'none'")
			content = previewWithNavigationBridge(content)
		} else {
			w.Header().Set("Content-Security-Policy", "sandbox allow-same-origin; script-src 'none'; object-src 'none'; form-action 'none'")
		}
	}
	w.WriteHeader(http.StatusOK)
	_, _ = io.WriteString(w, content)
}

const previewNavigationBridge = `<script>(function(){window.addEventListener('click',function(event){
if(event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
var target=event.target;if(!(target instanceof Element))return;
var link=target.closest('a[href]');if(!link)return;
var url=new URL(link.href);if(url.hash&&url.href.split('#')[0]===location.href.split('#')[0])return;
if(url.protocol==='http:'||url.protocol==='https:'){
event.preventDefault();parent.postMessage({markportPreviewLink:url.href},'*');
}
});})();</script>`

func previewWithNavigationBridge(content string) string {
	lower := strings.ToLower(content)
	if at := strings.LastIndex(lower, "</body>"); at >= 0 {
		return content[:at] + previewNavigationBridge + content[at:]
	}
	if at := strings.LastIndex(lower, "</html>"); at >= 0 {
		return content[:at] + previewNavigationBridge + content[at:]
	}
	return content + previewNavigationBridge
}

func validSVG(data []byte) bool {
	decoder := xml.NewDecoder(bytes.NewReader(data))
	seenRoot, depth := false, 0
	for {
		token, err := decoder.Token()
		if err == io.EOF {
			return seenRoot && depth == 0
		}
		if err != nil {
			return false
		}
		switch value := token.(type) {
		case xml.StartElement:
			if depth == 0 {
				if seenRoot || value.Name.Local != "svg" || value.Name.Space != "" && value.Name.Space != "http://www.w3.org/2000/svg" {
					return false
				}
				seenRoot = true
			}
			depth++
		case xml.EndElement:
			depth--
		case xml.CharData:
			if depth == 0 && len(bytes.TrimSpace(value)) > 0 {
				return false
			}
		}
	}
}
func (s *Server) events(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "SSE unsupported", 500)
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	ch := make(chan string, 8)
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		http.Error(w, "server closed", 503)
		return
	}
	s.subs[ch] = struct{}{}
	initialWatchError := s.watchError
	s.mu.Unlock()
	defer func() {
		s.mu.Lock()
		if _, ok := s.subs[ch]; ok {
			delete(s.subs, ch)
			close(ch)
		}
		s.mu.Unlock()
	}()
	_, _ = fmt.Fprint(w, "event: ready\ndata: {}\n\n")
	flusher.Flush()
	if initialWatchError {
		_, _ = fmt.Fprint(w, "event: watch-error\ndata: {}\n\n")
		flusher.Flush()
	}
	for {
		select {
		case <-r.Context().Done():
			return
		case event, ok := <-ch:
			if !ok {
				return
			}
			_, _ = fmt.Fprintf(w, "event: %s\ndata: {}\n\n", event)
			flusher.Flush()
		}
	}
}
