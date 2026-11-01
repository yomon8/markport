package server

import (
	"bufio"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/markport/markport/internal/files"
)

func requireWatch(t *testing.T, app *Server) {
	t.Helper()
	failures := app.StartWatch(t.Context())
	t.Cleanup(app.StopWatch)
	deadline := time.Now().Add(4 * time.Second)
	for time.Now().Before(deadline) {
		app.watchMu.RLock()
		watcher := app.watcher
		app.watchMu.RUnlock()
		if watcher != nil {
			if watcher.Mode() == "watch" {
				return
			}
			if runtime.GOOS != "linux" && runtime.GOOS != "windows" {
				t.Skip("push watching is unavailable on this platform")
			}
			t.Fatal("watch initialization fell back to polling")
		}
		select {
		case err, ok := <-failures:
			if ok && err != nil {
				t.Fatal(err)
			}
		default:
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatal("watch initialization timed out")
}

func openEvents(t *testing.T, client *http.Client, endpoint string, ctx context.Context) *http.Response {
	t.Helper()
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint+"/api/events", nil)
	if err != nil {
		t.Fatal(err)
	}
	request.Host = "localhost:3000"
	response, err := client.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = response.Body.Close() })
	return response
}

func readEvent(t *testing.T, reader *bufio.Reader) (string, []byte) {
	t.Helper()
	name, data := "", ""
	for {
		line, err := reader.ReadString('\n')
		if err != nil {
			t.Fatal(err)
		}
		line = strings.TrimSuffix(strings.TrimSuffix(line, "\n"), "\r")
		if line == "" && name != "" {
			return name, []byte(data)
		}
		if value, ok := strings.CutPrefix(line, "event: "); ok {
			name = value
		}
		if value, ok := strings.CutPrefix(line, "data: "); ok {
			data = value
		}
	}
}

func eventuallyEvents(t *testing.T, check func() bool) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if check() {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatal("event connection was not released")
}

func TestEventsPollingAndHTTPGuards(t *testing.T) {
	app, _ := newTestServer(t)
	response := request(app, "localhost:3000", "/api/events")
	if response.Code != 200 || response.Header().Get("Content-Type") != "text/event-stream" || response.Header().Get("Cache-Control") != "no-store" || response.Body.String() != "event: mode\ndata: {\"mode\":\"poll\"}\n\n" {
		t.Fatalf("poll event: %d %s", response.Code, response.Body.String())
	}
	if got := request(app, "evil.example:3000", "/api/events").Code; got != 400 {
		t.Fatalf("invalid Host: %d", got)
	}
	post := httptest.NewRequest(http.MethodPost, "/api/events", nil)
	post.Host = "localhost:3000"
	writer := httptest.NewRecorder()
	app.ServeHTTP(writer, post)
	if writer.Code != http.StatusMethodNotAllowed {
		t.Fatalf("POST: %d", writer.Code)
	}
	withoutFlush := &noEventFlusher{header: make(http.Header)}
	get := httptest.NewRequest(http.MethodGet, "/api/events", nil)
	get.Host = "localhost:3000"
	app.ServeHTTP(withoutFlush, get)
	if withoutFlush.status != http.StatusInternalServerError {
		t.Fatalf("without Flusher: %d", withoutFlush.status)
	}
}

type noEventFlusher struct {
	header http.Header
	status int
}

func (w *noEventFlusher) Header() http.Header            { return w.header }
func (w *noEventFlusher) WriteHeader(status int)         { w.status = status }
func (w *noEventFlusher) Write(data []byte) (int, error) { return len(data), nil }

func TestEventsChangeInvalidatesIndexBeforeDelivery(t *testing.T) {
	app, directory := newTestServer(t)
	requireWatch(t, app)
	if response := request(app, "localhost:3000", "/api/search-index"); response.Code != 200 {
		t.Fatal(response.Body.String())
	}
	server := httptest.NewServer(app)
	t.Cleanup(server.Close)
	response := openEvents(t, &http.Client{Timeout: 5 * time.Second}, server.URL, t.Context())
	reader := bufio.NewReader(response.Body)
	name, data := readEvent(t, reader)
	if name != "mode" || string(data) != `{"mode":"watch"}` {
		t.Fatalf("mode: %s %s", name, data)
	}
	if err := os.WriteFile(filepath.Join(directory, "new.md"), []byte("new"), 0644); err != nil {
		t.Fatal(err)
	}
	name, data = readEvent(t, reader)
	var batch files.ChangeBatch
	if name != "change" || json.Unmarshal(data, &batch) != nil || !batch.Created || batch.Overflow || batch.Git || len(batch.Paths) != 1 || batch.Paths[0] != "new.md" {
		t.Fatalf("change: %s %s", name, data)
	}
	app.searchMu.Lock()
	expired := app.searchExpires.Before(time.Now())
	app.searchMu.Unlock()
	if !expired {
		t.Fatal("change reached client before cache invalidation")
	}
	listing := request(app, "localhost:3000", "/api/search-index")
	if listing.Code != 200 || !strings.Contains(listing.Body.String(), `"new.md"`) {
		t.Fatalf("stale index: %s", listing.Body.String())
	}
}

func TestEventsConnectionLimitAndUnsubscribe(t *testing.T) {
	app, _ := newTestServer(t)
	requireWatch(t, app)
	server := httptest.NewServer(app)
	t.Cleanup(server.Close)
	client := &http.Client{Timeout: 10 * time.Second}
	var responses []*http.Response
	for range maxEventClients {
		response := openEvents(t, client, server.URL, t.Context())
		if response.StatusCode != 200 {
			t.Fatalf("connection: %d", response.StatusCode)
		}
		name, data := readEvent(t, bufio.NewReader(response.Body))
		if name != "mode" || string(data) != `{"mode":"watch"}` {
			t.Fatalf("mode: %s %s", name, data)
		}
		responses = append(responses, response)
	}
	rejected := openEvents(t, client, server.URL, t.Context())
	if rejected.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("connection limit: %d", rejected.StatusCode)
	}
	_ = responses[0].Body.Close()
	eventuallyEvents(t, func() bool {
		app.watchMu.RLock()
		count := len(app.eventSubscribers)
		app.watchMu.RUnlock()
		return count == maxEventClients-1 && app.eventClients.Load() == maxEventClients-1
	})
}

func TestEventsClientCancellationAndWatchStop(t *testing.T) {
	app, _ := newTestServer(t)
	requireWatch(t, app)
	server := httptest.NewServer(app)
	t.Cleanup(server.Close)
	ctx, cancel := context.WithCancel(t.Context())
	response := openEvents(t, &http.Client{Timeout: 5 * time.Second}, server.URL, ctx)
	_, _ = readEvent(t, bufio.NewReader(response.Body))
	cancel()
	eventuallyEvents(t, func() bool {
		app.watchMu.RLock()
		count := len(app.eventSubscribers)
		app.watchMu.RUnlock()
		return count == 0 && app.eventClients.Load() == 0
	})
	response = openEvents(t, &http.Client{Timeout: 5 * time.Second}, server.URL, t.Context())
	reader := bufio.NewReader(response.Body)
	_, _ = readEvent(t, reader)
	app.StopWatch()
	name, data := readEvent(t, reader)
	if name != "mode" || string(data) != `{"mode":"poll"}` {
		t.Fatalf("fallback: %s %s", name, data)
	}
	if _, err := reader.ReadByte(); err != io.EOF {
		t.Fatalf("poll connection did not close: %v", err)
	}
}

func TestEventsGitMetadataDoesNotExposePaths(t *testing.T) {
	app, directory := newTestServer(t)
	gitCommand(t, directory, "init", "-q")
	requireWatch(t, app)
	server := httptest.NewServer(app)
	t.Cleanup(server.Close)
	response := openEvents(t, &http.Client{Timeout: 5 * time.Second}, server.URL, t.Context())
	reader := bufio.NewReader(response.Body)
	_, _ = readEvent(t, reader)
	gitCommand(t, directory, "add", "readme.md")
	name, data := readEvent(t, reader)
	var batch files.ChangeBatch
	if name != "change" || json.Unmarshal(data, &batch) != nil || !batch.Git || len(batch.Paths) != 0 || batch.Created || strings.Contains(string(data), ".git") {
		t.Fatalf("private metadata: %s %s", name, data)
	}
}

func TestEventsRepositoryCreatedAfterStartup(t *testing.T) {
	app, directory := newTestServer(t)
	requireWatch(t, app)
	server := httptest.NewServer(app)
	t.Cleanup(server.Close)
	response := openEvents(t, &http.Client{Timeout: 5 * time.Second}, server.URL, t.Context())
	reader := bufio.NewReader(response.Body)
	_, _ = readEvent(t, reader)
	gitCommand(t, directory, "init", "-q")
	gitCommand(t, directory, "add", "readme.md")
	listing := request(app, "localhost:3000", "/api/git/changes")
	if listing.Code != 200 {
		t.Fatal(listing.Body.String())
	}
	app.watchMu.RLock()
	ready := app.gitWatchReady
	app.watchMu.RUnlock()
	if !ready {
		t.Fatal("new repository metadata was not registered")
	}
	_, _ = readEvent(t, reader)
	gitCommand(t, directory, "add", "code.py")
	name, data := readEvent(t, reader)
	var batch files.ChangeBatch
	if name != "change" || json.Unmarshal(data, &batch) != nil || !batch.Git || len(batch.Paths) != 0 {
		t.Fatalf("new repository index: %s %s", name, data)
	}
}

func TestStartWatchFailureKeepsServerAvailable(t *testing.T) {
	app, directory := newTestServer(t)
	gitCommand(t, directory, "init", "-q")
	if err := os.Remove(filepath.Join(directory, ".git", "refs", "heads")); err != nil {
		t.Fatal(err)
	}
	failures := app.StartWatch(t.Context())
	t.Cleanup(app.StopWatch)
	if runtime.GOOS != "linux" && runtime.GOOS != "windows" {
		t.Skip("poll platforms do not register extra directories")
	}
	select {
	case err := <-failures:
		if err == nil {
			t.Fatal("expected a watch initialization failure")
		}
	case <-time.After(4 * time.Second):
		t.Fatal("watch failure was not reported")
	}
	if response := request(app, "localhost:3000", "/api/tree"); response.Code != 200 {
		t.Fatalf("fallback server: %d", response.Code)
	}
	if response := request(app, "localhost:3000", "/api/events"); !strings.Contains(response.Body.String(), `"mode":"poll"`) {
		t.Fatal(response.Body.String())
	}
}
