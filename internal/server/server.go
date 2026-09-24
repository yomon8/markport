package server

import (
	"bytes"
	"encoding/json"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net"
	"net/http"
	"net/url"
	"path"
	"path/filepath"
	"strconv"
	"strings"
	"sync"

	"github.com/markport/markport/internal/files"
	"github.com/markport/markport/internal/render"
	"github.com/markport/markport/internal/web"
)

const maxAssetSize = 32 << 20

var imageContentTypes = map[string]string{
	".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
	".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml",
}

func imageContentType(name string) (string, bool) {
	contentType, ok := imageContentTypes[strings.ToLower(path.Ext(name))]
	return contentType, ok
}

type Server struct {
	Files      *files.Store
	Port       int
	mu         sync.Mutex
	subs       map[chan string]struct{}
	closed     bool
	watchError bool
	static     http.Handler
}

func New(store *files.Store, port int) (*Server, error) {
	dist, err := fs.Sub(web.Dist, "dist")
	if err != nil {
		return nil, err
	}
	return &Server{Files: store, Port: port, subs: make(map[chan string]struct{}), static: http.FileServer(http.FS(dist))}, nil
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
	if !validHost(r.Host, s.Port) {
		http.Error(w, "invalid Host", http.StatusBadRequest)
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
	case "/api/file":
		s.file(w, r)
	case "/api/asset":
		s.asset(w, r)
	case "/api/events":
		s.events(w, r)
	case "/":
		s.static.ServeHTTP(w, r)
	default:
		if strings.HasPrefix(r.URL.Path, "/assets/") {
			s.static.ServeHTTP(w, r)
		} else {
			http.NotFound(w, r)
		}
	}
}

func validHost(raw string, port int) bool {
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
	if !strings.EqualFold(host, "localhost") && host != "127.0.0.1" {
		return false
	}
	n, err := strconv.Atoi(p)
	return err == nil && n == port && p != ""
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
func (s *Server) tree(w http.ResponseWriter, r *http.Request) {
	nodes, err := s.Files.Tree()
	if err != nil {
		apiError(w, err)
		return
	}
	jsonReply(w, 200, map[string]any{"entries": nodes, "root": filepath.Base(s.Files.Path)})
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
		assetURL := "/api/asset?path=" + url.QueryEscape(name) + "&v=" + strconv.FormatInt(info.ModTime().UnixNano(), 10) + "-" + strconv.FormatInt(info.Size(), 10)
		jsonReply(w, 200, map[string]string{"path": name, "type": "image", "assetUrl": assetURL})
		return
	}
	content, err := s.Files.ReadText(name)
	if err != nil {
		apiError(w, err)
		return
	}
	kind, output := "code", ""
	if r.URL.Query().Get("source") == "1" {
		if strings.EqualFold(path.Ext(name), ".md") || strings.EqualFold(path.Ext(name), ".markdown") {
			kind = "markdown"
		}
		output = render.Code(name, content)
	} else if strings.EqualFold(path.Ext(name), ".md") || strings.EqualFold(path.Ext(name), ".markdown") {
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
