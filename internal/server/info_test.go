package server

import (
	"encoding/json"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/markport/markport/internal/discovery"
)

func TestInstanceInfoDoesNotDiscover(t *testing.T) {
	app, _ := newTestServer(t)
	app.Version = "dev"
	app.Registry = &discovery.Registry{Directory: filepath.Join(t.TempDir(), "missing")}
	response := request(app, "localhost:3000", "/api/instance")
	var info discovery.Info
	if response.Code != 200 || json.Unmarshal(response.Body.Bytes(), &info) != nil || info.RootPath != app.Files.Path || info.Version != "dev" || response.Header().Get("X-Markport-Instance") != app.instance || response.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("%s", response.Body.String())
	}
	if request(app, "invalid.example:3000", "/api/instance").Code != http.StatusBadRequest {
		t.Fatal("invalid host accepted")
	}
}

func TestServerInfoBranch(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("Git is unavailable")
	}
	dir := t.TempDir()
	app := gitServer(t, dir)
	checkInstance := func(path, branch string) {
		t.Helper()
		response := request(app, "localhost:3000", path)
		var info struct {
			Branch *string `json:"branch"`
		}
		if response.Code != http.StatusOK || json.Unmarshal(response.Body.Bytes(), &info) != nil {
			t.Fatalf("%s: %d %s", path, response.Code, response.Body.String())
		}
		if branch == "" && info.Branch == nil {
			return
		}
		if info.Branch == nil || *info.Branch != branch || branch == "" {
			t.Fatalf("%s: expected branch %q, got %s", path, branch, response.Body.String())
		}
	}
	checkList := func(branch string) {
		t.Helper()
		response := request(app, "localhost:3000", "/api/info")
		var info struct {
			Instances []discovery.Instance `json:"instances"`
		}
		if response.Code != http.StatusOK || json.Unmarshal(response.Body.Bytes(), &info) != nil || len(info.Instances) != 1 || !info.Instances[0].Current || info.Instances[0].Branch != branch {
			t.Fatalf("expected current server with branch %q, got %d %s", branch, response.Code, response.Body.String())
		}
	}

	checkInstance("/api/instance?branch=1", "")
	checkList("")
	gitCommand(t, dir, "init", "-q", "-b", "feature/docs")
	checkInstance("/api/instance", "")
	checkInstance("/api/instance?branch=1", "feature/docs")
	checkList("feature/docs")

	gitCommand(t, dir, "-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-qm", "initial", "--allow-empty", "--no-gpg-sign")
	gitCommand(t, dir, "switch", "-q", "--detach", "HEAD")
	short, err := exec.Command("git", "-C", dir, "rev-parse", "--short", "HEAD").Output()
	if err != nil {
		t.Fatal(err)
	}
	detached := "detached @ " + strings.TrimSpace(string(short))
	checkInstance("/api/instance?branch=1", detached)
	checkList(detached)
}

func TestServerInfoPreservesDetailsOnDiscoveryFailure(t *testing.T) {
	app, _ := newTestServer(t)
	app.WorkingDirectory = "/startup"
	path := filepath.Join(t.TempDir(), "file")
	if err := os.WriteFile(path, nil, 0600); err != nil {
		t.Fatal(err)
	}
	app.Registry = &discovery.Registry{Directory: path}
	response := request(app, "localhost:3000", "/api/info")
	var info struct {
		RootPath         string               `json:"rootPath"`
		WorkingDirectory string               `json:"workingDirectory"`
		Instances        []discovery.Instance `json:"instances"`
		InstancesError   string               `json:"instancesError"`
	}
	if response.Code != 200 || json.Unmarshal(response.Body.Bytes(), &info) != nil || info.RootPath != app.Files.Path || info.WorkingDirectory != "/startup" || len(info.Instances) != 1 || !info.Instances[0].Current || info.InstancesError == "" {
		t.Fatalf("%s", response.Body.String())
	}
}
