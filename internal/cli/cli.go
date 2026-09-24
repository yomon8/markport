package cli

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/markport/markport/internal/files"
	"github.com/markport/markport/internal/server"
)

var Version = "dev"

type Options struct {
	Directory         string
	Port              int
	Help, ShowVersion bool
}

func Parse(args []string) (Options, error) {
	o := Options{Directory: ".", Port: 3000}
	seenDir, seenPort := false, false
	for i := 0; i < len(args); i++ {
		a := args[i]
		switch {
		case a == "--help" || a == "-h":
			o.Help = true
		case a == "--version":
			o.ShowVersion = true
		case a == "--port" || strings.HasPrefix(a, "--port="):
			if seenPort {
				return o, errors.New("--port specified more than once")
			}
			seenPort = true
			value := ""
			if a == "--port" {
				i++
				if i >= len(args) {
					return o, errors.New("--port requires a number")
				}
				value = args[i]
			} else {
				value = strings.TrimPrefix(a, "--port=")
			}
			n, err := strconv.Atoi(value)
			if err != nil || n < 1 || n > 65535 {
				return o, fmt.Errorf("invalid port %q: expected 1–65535", value)
			}
			o.Port = n
		case strings.HasPrefix(a, "-"):
			return o, fmt.Errorf("unknown option %q", a)
		default:
			if seenDir {
				return o, errors.New("only one directory may be specified")
			}
			seenDir = true
			o.Directory = a
		}
	}
	return o, nil
}

func Run(args []string, stdout, stderr io.Writer) int {
	o, err := Parse(args)
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 2
	}
	if o.Help {
		fmt.Fprintln(stdout, "Usage: markport [directory] [--port PORT]\n       markport --help\n       markport --version")
		return 0
	}
	if o.ShowVersion {
		fmt.Fprintln(stdout, Version)
		return 0
	}
	store, err := files.New(o.Directory)
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	defer store.Close()
	listener, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", o.Port))
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	app, err := server.New(store, o.Port)
	if err != nil {
		listener.Close()
		fmt.Fprintln(stderr, err)
		return 1
	}
	watcher, err := files.NewWatcher(store, app.Publish)
	if err != nil {
		listener.Close()
		fmt.Fprintln(stderr, err)
		return 1
	}
	base, cancel := context.WithCancel(context.Background())
	httpServer := &http.Server{Handler: app, BaseContext: func(net.Listener) context.Context { return base }}
	serveDone := make(chan error, 1)
	go func() { serveDone <- httpServer.Serve(listener) }()
	fmt.Fprintf(stdout, "http://127.0.0.1:%d/\n", o.Port)
	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGINT, syscall.SIGTERM)
	defer signal.Stop(sig)
	select {
	case <-sig:
	case err := <-serveDone:
		if !errors.Is(err, http.ErrServerClosed) {
			fmt.Fprintln(stderr, err)
			cancel()
			watcher.Close()
			app.Close()
			return 1
		}
	}
	cancel()
	ctx, stop := context.WithTimeout(context.Background(), 5*time.Second)
	defer stop()
	if err := httpServer.Shutdown(ctx); err != nil {
		fmt.Fprintln(stderr, err)
		_ = httpServer.Close()
	}
	_ = watcher.Close()
	app.Close()
	return 0
}
