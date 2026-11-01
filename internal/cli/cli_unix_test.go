//go:build linux || darwin

package cli

import (
	"bufio"
	"bytes"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"
)

func TestShutdown(t *testing.T) {
	if os.Getenv("MARKPORT_CLI_HELPER") == "1" {
		os.Exit(Run(os.Args[len(os.Args)-3:], os.Stdout, os.Stderr))
	}
	testShutdown(t, syscall.SIGTERM, false)
}

func TestShutdownInterrupt(t *testing.T) { testShutdown(t, syscall.SIGINT, false) }

func TestShutdownWithSSE(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("live SSE connections require native watching")
	}
	testShutdown(t, syscall.SIGTERM, true)
}

func testShutdown(t *testing.T, signal os.Signal, withSSE bool) {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := listener.Addr().(*net.TCPAddr).Port
	listener.Close()
	command := exec.Command(os.Args[0], "-test.run=TestShutdown", t.TempDir(), "--port", strconv.Itoa(port))
	command.Env = append(os.Environ(), "MARKPORT_CLI_HELPER=1")
	cacheDirectory := t.TempDir()
	if runtime.GOOS == "linux" {
		command.Env = append(command.Env, "XDG_CACHE_HOME="+cacheDirectory)
	}
	var output bytes.Buffer
	command.Stdout = &output
	command.Stderr = &output
	if err := command.Start(); err != nil {
		t.Fatal(err)
	}
	defer func() { _ = command.Process.Kill(); _ = command.Wait() }()
	url := "http://127.0.0.1:" + strconv.Itoa(port) + "/api/instance"
	client := http.Client{Timeout: 2 * time.Second}
	var response *http.Response
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		response, err = client.Get(url)
		if err == nil {
			break
		}
		time.Sleep(30 * time.Millisecond)
	}
	if err != nil {
		t.Fatalf("server did not start: %v, %s", err, output.String())
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		t.Fatalf("instance: %d", response.StatusCode)
	}
	if runtime.GOOS == "linux" {
		entries, err := os.ReadDir(filepath.Join(cacheDirectory, "markport", "instances"))
		if err != nil || len(entries) != 1 {
			t.Fatalf("instance registration: %v, %d entries", err, len(entries))
		}
	}
	if withSSE {
		// No response-body timeout: the client must remain connected throughout
		// shutdown, rather than releasing the server when a client timer expires.
		transport := &http.Transport{ResponseHeaderTimeout: time.Second}
		defer transport.CloseIdleConnections()
		streamClient := &http.Client{Transport: transport}
		watching := false
		deadline := time.Now().Add(3 * time.Second)
		for time.Now().Before(deadline) {
			stream, err := streamClient.Get("http://127.0.0.1:" + strconv.Itoa(port) + "/api/events")
			if err != nil {
				t.Fatal(err)
			}
			reader := bufio.NewReader(stream.Body)
			_, err = reader.ReadString('\n')
			if err != nil {
				_ = stream.Body.Close()
				t.Fatal(err)
			}
			data, err := reader.ReadString('\n')
			if err != nil {
				_ = stream.Body.Close()
				t.Fatal(err)
			}
			if strings.Contains(data, `"mode":"watch"`) {
				defer stream.Body.Close()
				watching = true
				break
			}
			_ = stream.Body.Close()
			time.Sleep(10 * time.Millisecond)
		}
		if !watching {
			t.Fatal("SSE did not enter watch mode")
		}
	}
	if err := command.Process.Signal(signal); err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() { done <- command.Wait() }()
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("shutdown: %v, %s", err, output.String())
		}
	case <-time.After(3 * time.Second):
		t.Fatal("shutdown timed out")
	}
	if runtime.GOOS == "linux" {
		entries, err := os.ReadDir(filepath.Join(cacheDirectory, "markport", "instances"))
		if err != nil || len(entries) != 0 {
			t.Fatalf("instance cleanup: %v, %d entries", err, len(entries))
		}
	}

}
