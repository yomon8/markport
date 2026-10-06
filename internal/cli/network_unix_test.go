//go:build linux || darwin

package cli

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/markport/markport/internal/discovery"
)

func TestAutoPortStartup(t *testing.T) {
	if os.Getenv("MARKPORT_AUTO_PORT_HELPER") == "1" {
		os.Exit(Run(os.Args[3:], os.Stdout, os.Stderr))
	}
	for _, host := range []string{"127.0.0.1", "0.0.0.0"} {
		t.Run(host, func(t *testing.T) { testAutoPortStartup(t, host) })
	}
}

func testAutoPortStartup(t *testing.T, host string) {
	t.Helper()
	args := []string{"-test.run=^TestAutoPortStartup$", "--", t.TempDir(), "--auto-port"}
	lineCount := 1
	if host == "0.0.0.0" {
		args = append(args, "--lan")
		lineCount = 2
	}
	command := exec.Command(os.Args[0], args...)
	cacheDirectory := t.TempDir()
	command.Env = append(os.Environ(), "MARKPORT_AUTO_PORT_HELPER=1", "XDG_CACHE_HOME="+cacheDirectory)
	stdout, err := command.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	var stderr bytes.Buffer
	command.Stderr = &stderr
	if err := command.Start(); err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() {
		done <- command.Wait()
		close(done)
	}()
	defer func() {
		_ = command.Process.Kill()
		<-done
	}()
	startup := make(chan []string, 1)
	go func() {
		scanner := bufio.NewScanner(stdout)
		var lines []string
		for len(lines) < lineCount && scanner.Scan() {
			lines = append(lines, scanner.Text())
		}
		startup <- lines
	}()
	var lines []string
	select {
	case lines = <-startup:
		if len(lines) != lineCount {
			t.Fatalf("incomplete startup output: %v", lines)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("server did not print its URL")
	}
	baseURL, err := url.Parse(lines[0])
	if err != nil {
		t.Fatal(err)
	}
	port, err := strconv.Atoi(baseURL.Port())
	if err != nil || port < 1 || port > 65535 || baseURL.Scheme != "http" || baseURL.Hostname() != "127.0.0.1" || baseURL.Path != "/" {
		t.Fatalf("invalid startup URL: %q", lines[0])
	}
	if lineCount == 2 && lines[1] != fmt.Sprintf("LAN access: http://<this-machine-LAN-IP>:%d/", port) {
		t.Fatalf("LAN URL: %q", lines[1])
	}
	client := &http.Client{Timeout: 2 * time.Second}
	response, err := client.Get(lines[0] + "api/info")
	if err != nil {
		t.Fatal(err)
	}
	var info struct {
		Instances []discovery.Instance `json:"instances"`
	}
	err = json.NewDecoder(response.Body).Decode(&info)
	response.Body.Close()
	if err != nil || response.StatusCode != http.StatusOK {
		t.Fatalf("server info: status=%d info=%+v err=%v", response.StatusCode, info, err)
	}
	currentCount := 0
	for _, instance := range info.Instances {
		if instance.Current {
			currentCount++
			if instance.URL != lines[0] {
				t.Fatalf("current instance URL: %q, want %q", instance.URL, lines[0])
			}
		}
	}
	if currentCount != 1 {
		t.Fatalf("current instances: %d", currentCount)
	}
	for _, asJSON := range []bool{false, true} {
		listArgs := []string{"-test.run=^TestAutoPortStartup$", "--", "--list-servers"}
		if asJSON {
			listArgs = append(listArgs, "--json")
		}
		listCommand := exec.Command(os.Args[0], listArgs...)
		listCommand.Env = command.Env
		var output, errors bytes.Buffer
		listCommand.Stdout, listCommand.Stderr = &output, &errors
		if err := listCommand.Run(); err != nil || errors.Len() != 0 {
			t.Fatalf("CLI list: %v %s", err, errors.String())
		}
		var rootPath string
		for _, instance := range info.Instances {
			if instance.Current {
				rootPath = instance.RootPath
			}
		}
		if asJSON {
			var items []serverSummary
			if err := json.Unmarshal(output.Bytes(), &items); err != nil {
				t.Fatal(err)
			}
			found := false
			for _, item := range items {
				if item.URL == lines[0] && item.RootPath == rootPath && item.Version == Version {
					found = true
				}
			}
			if !found {
				t.Fatalf("running server missing from CLI JSON: %s", output.String())
			}
		} else if !strings.Contains(output.String(), lines[0]) || !strings.Contains(output.String(), rootPath) {
			t.Fatalf("running server missing from CLI table: %s", output.String())
		}
	}
	request, err := http.NewRequest(http.MethodGet, lines[0]+"api/info", nil)
	if err != nil {
		t.Fatal(err)
	}
	request.Host = "127.0.0.1:0"
	response, err = client.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusBadRequest {
		t.Fatalf("unassigned port accepted in Host: %d", response.StatusCode)
	}
	registryDirectory := filepath.Join(cacheDirectory, "markport", "instances")
	if runtime.GOOS == "linux" {
		entries, err := os.ReadDir(registryDirectory)
		if err != nil || len(entries) != 1 {
			t.Fatalf("instance registration: entries=%d err=%v", len(entries), err)
		}
		data, err := os.ReadFile(filepath.Join(registryDirectory, entries[0].Name()))
		if err != nil {
			t.Fatal(err)
		}
		var record discovery.Record
		if err := json.Unmarshal(data, &record); err != nil || record.Port != port || record.Host != host {
			t.Fatalf("instance record: %+v err=%v", record, err)
		}
	}
	response, err = client.Get(lines[0] + "api/events")
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("SSE: %d", response.StatusCode)
	}
	if err := command.Process.Signal(syscall.SIGTERM); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("shutdown: %v, %s", err, stderr.String())
		}
	case <-time.After(5 * time.Second):
		t.Fatal("shutdown blocked by SSE")
	}
	if runtime.GOOS == "linux" {
		entries, err := os.ReadDir(registryDirectory)
		if err != nil || len(entries) != 0 {
			t.Fatalf("instance cleanup: entries=%d err=%v", len(entries), err)
		}
		listCommand := exec.Command(os.Args[0], "-test.run=^TestAutoPortStartup$", "--", "--list-servers", "--json")
		listCommand.Env = command.Env
		output, err := listCommand.CombinedOutput()
		if err != nil || string(output) != "[]\n" {
			t.Fatalf("CLI after shutdown: %s %v", output, err)
		}
	}
	listener, err := net.Listen("tcp", net.JoinHostPort(host, strconv.Itoa(port)))
	if err != nil {
		t.Fatalf("port was not released: %v", err)
	}
	listener.Close()
}
