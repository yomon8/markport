package cli

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"github.com/markport/markport/internal/discovery"
)

func TestListServersOptions(t *testing.T) {
	for _, args := range [][]string{{"--list-servers"}, {"--list-servers", "--json"}, {"--json", "--list-servers"}} {
		o, err := Parse(args)
		if err != nil || !o.ListServers || o.JSON != (len(args) == 2) {
			t.Fatalf("%v: %+v %v", args, o, err)
		}
	}
	for _, extra := range [][]string{
		{"."}, {"notes"}, {"--host=127.0.0.1"}, {"--lan"}, {"--port", "3000"},
		{"--auto-port"}, {"--title="}, {"--update"}, {"--check-update"},
		{"--version"}, {"--list-servers"}, {"--json", "--json"},
	} {
		for _, args := range [][]string{append([]string{"--list-servers"}, extra...), append(append([]string{}, extra...), "--list-servers")} {
			var out, errout bytes.Buffer
			if code := Run(args, &out, &errout); code != 2 || errout.Len() == 0 || out.Len() != 0 {
				t.Fatalf("%v: code=%d output=%s error=%s", args, code, out.String(), errout.String())
			}
		}
	}
	for _, args := range [][]string{{"--json"}, {"--json", "--version"}, {"--json", "--update"}, {"--list-servers=true"}, {"--list-servers", "--json=true"}} {
		if _, err := Parse(args); err == nil {
			t.Errorf("accepted %v", args)
		}
	}
	for _, args := range [][]string{{"--help"}, {"--list-servers", "--json", "--help"}, {"--list-servers", "--version", "--help"}, {"--json", "--help"}} {
		var out, errout bytes.Buffer
		if code := Run(args, &out, &errout); code != 0 || errout.Len() != 0 || !strings.Contains(out.String(), "--list-servers [--json]") {
			t.Fatalf("help %v: code=%d output=%s error=%s", args, code, out.String(), errout.String())
		}
	}
	o, err := Parse([]string{"servers"})
	if err != nil || o.Directory != "servers" || o.ListServers {
		t.Fatalf("servers directory: %+v %v", o, err)
	}
}

func TestListServersOutput(t *testing.T) {
	registry := &discovery.Registry{Directory: t.TempDir()}
	for i, root := range []string{"/z", "/作業 ノート", "/a"} {
		id := fmt.Sprintf("%032x", i+1)
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("X-Markport-Instance", id)
			_ = json.NewEncoder(w).Encode(discovery.Info{RootPath: root, Version: "v1.2.3"})
		}))
		defer server.Close()
		port, err := strconv.Atoi(strings.TrimPrefix(server.URL, "http://127.0.0.1:"))
		if err != nil {
			t.Fatal(err)
		}
		cleanup, err := registry.Register(discovery.Record{ID: id, PID: os.Getpid(), Host: "127.0.0.1", Port: port})
		if err != nil {
			t.Fatal(err)
		}
		defer cleanup()
	}
	for _, asJSON := range []bool{false, true} {
		var out, errout bytes.Buffer
		if code := listServers(context.Background(), registry, asJSON, &out, &errout); code != 0 || errout.Len() != 0 {
			t.Fatalf("list: code=%d error=%s", code, errout.String())
		}
		if asJSON {
			var items []map[string]string
			if err := json.Unmarshal(out.Bytes(), &items); err != nil || len(items) != 3 {
				t.Fatalf("JSON: %s %v", out.String(), err)
			}
			for i, root := range []string{"/a", "/z", "/作業 ノート"} {
				if len(items[i]) != 3 || items[i]["rootPath"] != root || items[i]["version"] != "v1.2.3" || !strings.HasPrefix(items[i]["url"], "http://127.0.0.1:") {
					t.Fatalf("JSON row: %+v", items[i])
				}
			}
		} else {
			lines := strings.Split(strings.TrimSpace(out.String()), "\n")
			if len(lines) != 4 || strings.Join(strings.Fields(lines[0]), " ") != "URL VERSION DIRECTORY" {
				t.Fatalf("table: %s", out.String())
			}
			for i, root := range []string{"/a", "/z", "/作業 ノート"} {
				if !strings.HasSuffix(lines[i+1], root) || !strings.Contains(lines[i+1], "v1.2.3") || !strings.HasPrefix(lines[i+1], "http://127.0.0.1:") {
					t.Fatalf("table row: %s", lines[i+1])
				}
			}
		}
	}
}

func TestListServersEmptyAndFailures(t *testing.T) {
	for _, asJSON := range []bool{false, true} {
		registry := &discovery.Registry{Directory: filepath.Join(t.TempDir(), "missing")}
		var out, errout bytes.Buffer
		want := "No running Markport servers found.\n"
		if asJSON {
			want = "[]\n"
		}
		if code := listServers(context.Background(), registry, asJSON, &out, &errout); code != 0 || out.String() != want || errout.Len() != 0 {
			t.Fatalf("empty: code=%d output=%s error=%s", code, out.String(), errout.String())
		}
		registry.Directory = filepath.Join(t.TempDir(), "file")
		if err := os.WriteFile(registry.Directory, nil, 0600); err != nil {
			t.Fatal(err)
		}
		out.Reset()
		if code := listServers(context.Background(), registry, asJSON, &out, &errout); code != 1 || out.Len() != 0 || errout.Len() == 0 {
			t.Fatalf("failure: code=%d output=%s error=%s", code, out.String(), errout.String())
		}
		registry.Directory = t.TempDir()
		ctx, cancel := context.WithCancel(context.Background())
		cancel()
		errout.Reset()
		if code := listServers(ctx, registry, asJSON, &out, &errout); code != 1 || out.Len() != 0 || errout.Len() == 0 {
			t.Fatalf("timeout: code=%d output=%s error=%s", code, out.String(), errout.String())
		}
	}
}

func TestServerTableEscapesRowSeparators(t *testing.T) {
	var out bytes.Buffer
	items := []discovery.Instance{{Info: discovery.Info{RootPath: "/作業\tノート\r\n", Version: "dev"}, URL: "http://127.0.0.1:1234/"}}
	if err := printServers(items, false, &out); err != nil || strings.Count(out.String(), "\n") != 2 || !strings.Contains(out.String(), "/作業\\tノート\\r\\n") {
		t.Fatalf("table: %s %v", out.String(), err)
	}
}
