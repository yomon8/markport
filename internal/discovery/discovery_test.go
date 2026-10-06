package discovery

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func recordFor(t *testing.T, id int, server *httptest.Server) Record {
	t.Helper()
	host, port, err := net.SplitHostPort(server.Listener.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	number, _ := strconv.Atoi(port)
	return Record{ID: fmt.Sprintf("%032x", id), PID: os.Getpid(), Host: host, Port: number}
}

func register(t *testing.T, registry *Registry, record Record) func() {
	t.Helper()
	cleanup, err := registry.Register(record)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(cleanup)
	return cleanup
}

func TestListChecksIdentityAndLiveness(t *testing.T) {
	registry := &Registry{Directory: t.TempDir()}
	self := Record{ID: fmt.Sprintf("%032x", 1), PID: os.Getpid(), Host: "127.0.0.1", Port: 3000}
	register(t, registry, self)
	var servers []*httptest.Server
	for i, root := range []string{"/z", "/a", "/a", "/wrong-id", "/stopped"} {
		id := i + 2
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path != "/api/instance" {
				t.Errorf("unexpected path %s", r.URL.Path)
			}
			responseID := id
			if root == "/wrong-id" {
				responseID = 99
			}
			w.Header().Set("X-Markport-Instance", fmt.Sprintf("%032x", responseID))
			_ = json.NewEncoder(w).Encode(Info{RootPath: root, Version: "v1.0.0"})
		}))
		t.Cleanup(server.Close)
		register(t, registry, recordFor(t, id, server))
		servers = append(servers, server)
	}
	servers[4].Close() // Leave a stale record, as after an abnormal exit.
	if err := os.WriteFile(filepath.Join(registry.Directory, "broken.json"), []byte("{"), 0600); err != nil {
		t.Fatal(err)
	}
	// Remote registrations must never be contacted.
	register(t, registry, Record{ID: fmt.Sprintf("%032x", 88), PID: os.Getpid(), Host: "192.0.2.1", Port: 80})
	list, err := registry.List(context.Background(), self, Info{RootPath: "/self", Version: "dev"}, "localhost:3000")
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 4 || !list[0].Current || list[0].RootPath != "/self" || list[1].RootPath != "/a" || list[2].RootPath != "/a" || list[3].RootPath != "/z" || list[1].Port > list[2].Port {
		t.Fatalf("unexpected list: %+v", list)
	}
	for _, item := range list[1:] {
		if item.Current || item.Version != "v1.0.0" {
			t.Fatalf("unexpected metadata: %+v", item)
		}
	}
	discovered, err := registry.Discover(context.Background())
	if err != nil || len(discovered) != 3 {
		t.Fatalf("discovered: %+v %v", discovered, err)
	}
	for i, item := range discovered {
		if item.Current || item != list[i+1] {
			t.Fatalf("CLI and browser disagree: %+v %+v", item, list[i+1])
		}
	}
}

func TestRegistrationConcurrentAndCleanup(t *testing.T) {
	registry := &Registry{Directory: filepath.Join(t.TempDir(), "instances")}
	var workers sync.WaitGroup
	var cleanups sync.Map
	for i := range 20 {
		workers.Add(1)
		go func() {
			defer workers.Done()
			cleanup, err := registry.Register(Record{ID: fmt.Sprintf("%032x", i), PID: os.Getpid(), Host: "127.0.0.1", Port: 3000 + i})
			if err != nil {
				t.Error(err)
				return
			}
			cleanups.Store(i, cleanup)
		}()
	}
	workers.Wait()
	entries, err := os.ReadDir(registry.Directory)
	if err != nil || len(entries) != 20 {
		t.Fatalf("registration: %v, %d entries", err, len(entries))
	}
	cleanups.Range(func(_, value any) bool { value.(func())(); return true })
	entries, err = os.ReadDir(registry.Directory)
	if err != nil || len(entries) != 0 {
		t.Fatalf("cleanup: %v, %d entries", err, len(entries))
	}
}

func TestDiscoveryFailuresPreserveSelf(t *testing.T) {
	file := filepath.Join(t.TempDir(), "not-directory")
	if err := os.WriteFile(file, nil, 0600); err != nil {
		t.Fatal(err)
	}
	registry := &Registry{Directory: file}
	self := Record{ID: strings.Repeat("a", 32), PID: os.Getpid(), Host: "127.0.0.1", Port: 3000}
	if _, err := registry.Register(self); err == nil {
		t.Fatal("registration should fail")
	}
	list, err := registry.List(context.Background(), self, Info{RootPath: "/self"}, "localhost:3000")
	if err == nil || len(list) != 1 || !list[0].Current {
		t.Fatalf("%+v %v", list, err)
	}
	registry.Directory = filepath.Join(t.TempDir(), "missing")
	list, err = registry.List(context.Background(), self, Info{RootPath: "/self"}, "localhost:3000")
	if err != nil || len(list) != 1 {
		t.Fatalf("%+v %v", list, err)
	}
}

func TestDiscoveryDeadlineAndNoRedirects(t *testing.T) {
	registry := &Registry{Directory: t.TempDir()}
	self := Record{ID: strings.Repeat("a", 32), PID: os.Getpid(), Host: "127.0.0.1", Port: 3000}
	var redirected atomic.Int32
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { redirected.Add(1) }))
	defer target.Close()
	redirect := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { http.Redirect(w, r, target.URL, http.StatusFound) }))
	defer redirect.Close()
	cleanup := register(t, registry, recordFor(t, 1, redirect))
	list, err := registry.List(context.Background(), self, Info{RootPath: "/self"}, "localhost:3000")
	if err != nil || len(list) != 1 || redirected.Load() != 0 {
		t.Fatalf("redirect followed: %+v %v %d", list, err, redirected.Load())
	}
	discovered, err := registry.Discover(context.Background())
	if err != nil || len(discovered) != 0 || redirected.Load() != 0 {
		t.Fatalf("CLI redirect followed: %+v %v %d", discovered, err, redirected.Load())
	}
	cleanup()
	slow := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { <-r.Context().Done() }))
	defer slow.Close()
	register(t, registry, recordFor(t, 2, slow))
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Millisecond)
	defer cancel()
	list, err = registry.List(ctx, self, Info{RootPath: "/self"}, "localhost:3000")
	if err == nil || len(list) != 1 {
		t.Fatalf("deadline: %+v %v", list, err)
	}
}

func TestDiscoverLocalLinks(t *testing.T) {
	registry := &Registry{Directory: t.TempDir()}
	for i, host := range []string{"127.0.0.1", "0.0.0.0"} {
		id := i + 1
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("X-Markport-Instance", fmt.Sprintf("%032x", id))
			_ = json.NewEncoder(w).Encode(Info{RootPath: "/作業 ノート", Version: "dev"})
		}))
		defer server.Close()
		record := recordFor(t, id, server)
		record.Host = host
		register(t, registry, record)
	}
	items, err := registry.Discover(context.Background())
	if err != nil || len(items) != 2 {
		t.Fatalf("discovered: %+v %v", items, err)
	}
	for _, item := range items {
		if item.Current || item.UnavailableReason != "" || item.RootPath != "/作業 ノート" || item.URL != "http://127.0.0.1:"+strconv.Itoa(item.Port)+"/" {
			t.Fatalf("local instance: %+v", item)
		}
	}
	if items[0].Port > items[1].Port {
		t.Fatalf("not sorted by port: %+v", items)
	}
}

func TestDiscoverEmptyAndErrors(t *testing.T) {
	registry := &Registry{Directory: filepath.Join(t.TempDir(), "missing")}
	items, err := registry.Discover(context.Background())
	if err != nil || items == nil || len(items) != 0 {
		t.Fatalf("missing registry: %+v %v", items, err)
	}
	registry.Directory = t.TempDir()
	items, err = registry.Discover(context.Background())
	if err != nil || len(items) != 0 {
		t.Fatalf("empty registry: %+v %v", items, err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if items, err := registry.Discover(ctx); err == nil || len(items) != 0 {
		t.Fatalf("cancellation: %+v %v", items, err)
	}
	registry.Directory = filepath.Join(t.TempDir(), "file")
	if err := os.WriteFile(registry.Directory, nil, 0600); err != nil {
		t.Fatal(err)
	}
	if items, err := registry.Discover(context.Background()); err == nil || len(items) != 0 {
		t.Fatalf("invalid registry: %+v %v", items, err)
	}
}

func TestLinks(t *testing.T) {
	for _, tc := range []struct{ host, request, url, reason string }{
		{"0.0.0.0", "localhost", "http://localhost:4000/", ""},
		{"0.0.0.0", "localhost:3000", "http://localhost:4000/", ""},
		{"0.0.0.0", "192.168.1.2:3000", "http://192.168.1.2:4000/", ""},
		{"192.168.1.3", "192.168.1.2:3000", "http://192.168.1.3:4000/", ""},
		{"127.0.0.1", "localhost:3000", "http://127.0.0.1:4000/", ""},
		{"127.0.0.2", "127.0.0.1:3000", "http://127.0.0.2:4000/", ""},
		{"127.0.0.1", "192.168.1.2:3000", "", "Local access only"},
	} {
		t.Run(tc.host+"/"+tc.request, func(t *testing.T) {
			item := Link(Record{Host: tc.host, Port: 4000}, Info{RootPath: "/notes"}, false, tc.request)
			if item.URL != tc.url || item.UnavailableReason != tc.reason {
				t.Fatalf("%+v", item)
			}
		})
	}
}

func TestInvalidRecords(t *testing.T) {
	valid := Record{ID: strings.Repeat("b", 32), PID: os.Getpid(), Host: "127.0.0.1", Port: 3000}
	for _, modify := range []func(*Record){func(r *Record) { r.ID = "../bad" }, func(r *Record) { r.Host = "localhost" }, func(r *Record) { r.Port = 0 }, func(r *Record) { r.PID = 0 }} {
		record := valid
		modify(&record)
		if _, err := (&Registry{Directory: t.TempDir()}).Register(record); err == nil {
			t.Fatalf("accepted %+v", record)
		}
	}
}

func TestDiscoveryOverallBudgetAndConcurrency(t *testing.T) {
	registry := &Registry{Directory: t.TempDir()}
	self := Record{ID: strings.Repeat("a", 32), PID: os.Getpid(), Host: "127.0.0.1", Port: 3000}
	var active, maximum atomic.Int32
	slow := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		running := active.Add(1)
		for {
			previous := maximum.Load()
			if running <= previous || maximum.CompareAndSwap(previous, running) {
				break
			}
		}
		defer active.Add(-1)
		<-r.Context().Done()
	}))
	defer slow.Close()
	for i := range 40 {
		register(t, registry, recordFor(t, i+1, slow))
	}
	started := time.Now()
	list, err := registry.List(context.Background(), self, Info{RootPath: "/self"}, "localhost:3000")
	if err == nil || len(list) != 1 || time.Since(started) > 3*time.Second {
		t.Fatalf("budget: %+v %v %s", list, err, time.Since(started))
	}
	if maximum.Load() < 2 {
		t.Fatalf("probes were not concurrent: %d", maximum.Load())
	}
}
