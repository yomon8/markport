package server

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
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
