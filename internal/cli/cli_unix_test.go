//go:build linux || darwin

package cli

import (
	"bytes"
	"net"
	"net/http"
	"os"
	"os/exec"
	"strconv"
	"syscall"
	"testing"
	"time"
)

func TestShutdownWithSSE(t *testing.T) {
	if os.Getenv("MARKPORT_CLI_HELPER") == "1" {
		os.Exit(Run(os.Args[len(os.Args)-3:], os.Stdout, os.Stderr))
	}
	testShutdownWithSSE(t, syscall.SIGTERM)
}

func TestShutdownWithSSEInterrupt(t *testing.T) { testShutdownWithSSE(t, syscall.SIGINT) }

func testShutdownWithSSE(t *testing.T, signal os.Signal) {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := listener.Addr().(*net.TCPAddr).Port
	listener.Close()
	command := exec.Command(os.Args[0], "-test.run=TestShutdownWithSSE", t.TempDir(), "--port", strconv.Itoa(port))
	command.Env = append(os.Environ(), "MARKPORT_CLI_HELPER=1")
	var output bytes.Buffer
	command.Stdout = &output
	command.Stderr = &output
	if err := command.Start(); err != nil {
		t.Fatal(err)
	}
	defer func() { _ = command.Process.Kill(); _ = command.Wait() }()
	url := "http://127.0.0.1:" + strconv.Itoa(port) + "/api/events"
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
		t.Fatalf("SSE: %d", response.StatusCode)
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
		t.Fatal("shutdown blocked by SSE")
	}
}
