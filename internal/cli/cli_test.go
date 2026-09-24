package cli

import (
	"bytes"
	"net"
	"strconv"
	"strings"
	"testing"
)

func TestParse(t *testing.T) {
	for _, args := range [][]string{{}, {".", "--port", "4321"}, {"--port=4321", "."}} {
		o, err := Parse(args)
		if err != nil {
			t.Fatalf("%v: %v", args, err)
		}
		if len(args) > 0 && o.Port != 4321 {
			t.Fatalf("%v: %+v", args, o)
		}
		if o.Host != "127.0.0.1" {
			t.Fatalf("%v: %+v", args, o)
		}
	}
	for _, tc := range []struct {
		args []string
		host string
	}{{[]string{"--host", "0.0.0.0"}, "0.0.0.0"}, {[]string{"--host=192.168.1.10", "."}, "192.168.1.10"}} {
		o, err := Parse(tc.args)
		if err != nil || o.Host != tc.host {
			t.Fatalf("%v: %+v, %v", tc.args, o, err)
		}
	}
	for _, args := range [][]string{{"--port", "0"}, {"--port", "65536"}, {"--port", "abc"}, {"--port"}, {"--host"}, {"--host="}, {"--host", "localhost"}, {"--host", "::1"}, {"--host", "999.1.1.1"}, {"--host", "0.0.0.0", "--host", "127.0.0.1"}, {"--bad"}, {"one", "two"}} {
		if _, err := Parse(args); err == nil {
			t.Errorf("accepted %v", args)
		}
	}
}
func TestOutputAndOccupiedPort(t *testing.T) {
	var out, errout bytes.Buffer
	if code := Run([]string{"--help"}, &out, &errout); code != 0 || !strings.Contains(out.String(), "Usage:") {
		t.Fatalf("help: %d %s", code, out.String())
	}
	out.Reset()
	if code := Run([]string{"--version"}, &out, &errout); code != 0 || !strings.Contains(out.String(), Version) {
		t.Fatalf("version: %d %s", code, out.String())
	}
	if code := Run([]string{"missing-directory"}, &out, &errout); code == 0 {
		t.Fatal("accepted missing directory")
	}
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	port := listener.Addr().(*net.TCPAddr).Port
	errout.Reset()
	if code := Run([]string{"--port", strconv.Itoa(port)}, &out, &errout); code == 0 || errout.Len() == 0 {
		t.Fatalf("port %d: code=%d error=%s", port, code, errout.String())
	}
}
