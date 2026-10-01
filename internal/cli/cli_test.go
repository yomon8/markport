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

func TestUpdateFlags(t *testing.T) {
	for _, flag := range []string{"--update", "--check-update"} {
		t.Run(flag, func(t *testing.T) {
			o, err := Parse([]string{flag})
			if err != nil || o.Update != (flag == "--update") || o.CheckUpdate != (flag == "--check-update") {
				t.Fatalf("%+v, %v", o, err)
			}
			for _, args := range [][]string{
				{flag, flag}, {flag, "."}, {"update", flag}, {flag, "--host", "127.0.0.1"},
				{flag, "--port=3000"}, {flag, "--version"}, {"--update", "--check-update"},
			} {
				var out, errout bytes.Buffer
				if code := Run(args, &out, &errout); code != 2 || errout.Len() == 0 {
					t.Fatalf("%v: code=%d error=%s", args, code, errout.String())
				}
			}
			var out, errout bytes.Buffer
			if code := Run([]string{flag, "--help"}, &out, &errout); code != 0 || !strings.Contains(out.String(), "--check-update") || !strings.Contains(out.String(), "--update") || errout.Len() != 0 {
				t.Fatalf("help: %d %s %s", code, out.String(), errout.String())
			}
		})
	}
	o, err := Parse([]string{"update"})
	if err != nil || o.Directory != "update" || o.Update || o.CheckUpdate {
		t.Fatalf("update folder: %+v, %v", o, err)
	}
}

func TestDevelopmentUpdateRejected(t *testing.T) {
	old := Version
	Version = "dev"
	defer func() { Version = old }()
	var out, errout bytes.Buffer
	if code := Run([]string{"--update"}, &out, &errout); code != 1 || !strings.Contains(errout.String(), "development builds") || out.Len() != 0 {
		t.Fatalf("development update: %d %s %s", code, out.String(), errout.String())
	}
}

func TestTitleOption(t *testing.T) {
	for _, tc := range []struct {
		args []string
		want string
	}{
		{[]string{"notes", "--title", " 作業ノート "}, "作業ノート"},
		{[]string{"--title=Work notes", "notes"}, "Work notes"},
		{[]string{"--title="}, ""},
		{[]string{"--title", " \t "}, ""},
		{[]string{"--title=--name"}, "--name"},
	} {
		o, err := Parse(tc.args)
		if err != nil || o.Title != tc.want {
			t.Fatalf("%v: title=%q, err=%v", tc.args, o.Title, err)
		}
	}
	for _, args := range [][]string{
		{"--title"}, {"--title", "--port", "3000"}, {"--title=a", "--title", "b"},
		{"--update", "--title="}, {"--check-update", "--title", "notes"},
	} {
		var out, errout bytes.Buffer
		if code := Run(args, &out, &errout); code != 2 || errout.Len() == 0 {
			t.Fatalf("%v: code=%d error=%s", args, code, errout.String())
		}
	}
	var out, errout bytes.Buffer
	if code := Run([]string{"--help"}, &out, &errout); code != 0 || !strings.Contains(out.String(), "--title TEXT") {
		t.Fatalf("help: %d %s %s", code, out.String(), errout.String())
	}
}
