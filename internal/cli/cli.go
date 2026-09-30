package cli

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/netip"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/markport/markport/internal/files"
	"github.com/markport/markport/internal/server"
	"github.com/markport/markport/internal/update"
)

var Version = "dev"

type Options struct {
	Directory           string
	Host                string
	Port                int
	Help, ShowVersion   bool
	Update, CheckUpdate bool
}

func Parse(args []string) (Options, error) {
	o := Options{Directory: ".", Host: "127.0.0.1", Port: 3000}
	seenDir, seenHost, seenPort := false, false, false
	for i := 0; i < len(args); i++ {
		a := args[i]
		switch {
		case a == "--help" || a == "-h":
			o.Help = true
		case a == "--version":
			o.ShowVersion = true
		case a == "--update" || a == "--check-update":
			if o.Update || o.CheckUpdate {
				return o, errors.New("specify only one update flag, once")
			}
			o.Update = a == "--update"
			o.CheckUpdate = a == "--check-update"
		case a == "--host" || strings.HasPrefix(a, "--host="):
			if seenHost {
				return o, errors.New("--host specified more than once")
			}
			seenHost = true
			value := ""
			if a == "--host" {
				i++
				if i >= len(args) {
					return o, errors.New("--host requires an IPv4 address")
				}
				value = args[i]
			} else {
				value = strings.TrimPrefix(a, "--host=")
			}
			addr, err := netip.ParseAddr(value)
			if err != nil || !addr.Is4() {
				return o, fmt.Errorf("invalid host %q: expected an IPv4 address", value)
			}
			o.Host = addr.String()
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
	if !o.Help && (o.Update || o.CheckUpdate) && (seenDir || seenHost || seenPort || o.ShowVersion) {
		return o, errors.New("update flags must be used without a directory, --host, --port, or --version")
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
		fmt.Fprintln(stdout, "Usage: markport [directory] [--host IPv4] [--port PORT]\n       markport --help\n       markport --version\n       markport --check-update\n       markport --update")
		return 0
	}
	if o.ShowVersion {
		fmt.Fprintln(stdout, Version)
		return 0
	}
	if o.Update || o.CheckUpdate {
		ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
		defer stop()
		updater := update.New(Version)
		var result update.Result
		if o.Update {
			result, err = updater.Update(ctx)
		} else {
			result, err = updater.Check(ctx)
		}
		if err != nil {
			fmt.Fprintln(stderr, err)
			return 1
		}
		fmt.Fprintf(stdout, "Current version: %s\nLatest stable version: %s\n", result.Current, result.Latest)
		switch {
		case result.Updated:
			fmt.Fprintf(stdout, "Updated %s to %s at %s.\nRestart any running Markport servers manually to use the new version.\n", result.Current, result.Latest, result.Path)
		case !result.Comparable:
			fmt.Fprintln(stdout, "This development build cannot be compared or updated. Install an official release manually.")
		case result.Available:
			fmt.Fprintln(stdout, "Update available. Run markport --update to install it.")
		default:
			fmt.Fprintln(stdout, "No newer stable version is available.")
		}
		if result.Backup != "" {
			fmt.Fprintf(stdout, "Previous executable retained at %s; remove it after all old Markport processes exit.\n", result.Backup)
		}
		return 0
	}
	store, err := files.New(o.Directory)
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	defer store.Close()
	listener, err := net.Listen("tcp", net.JoinHostPort(o.Host, strconv.Itoa(o.Port)))
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	app, err := server.New(store, o.Host, o.Port)
	if err != nil {
		listener.Close()
		fmt.Fprintln(stderr, err)
		return 1
	}
	base, cancel := context.WithCancel(context.Background())
	httpServer := &http.Server{Handler: app, BaseContext: func(net.Listener) context.Context { return base }}
	serveDone := make(chan error, 1)
	go func() { serveDone <- httpServer.Serve(listener) }()
	if o.Host == "0.0.0.0" {
		fmt.Fprintf(stdout, "http://127.0.0.1:%d/\nLAN access: http://<this-machine-LAN-IP>:%d/\n", o.Port, o.Port)
	} else {
		fmt.Fprintf(stdout, "http://%s:%d/\n", o.Host, o.Port)
	}
	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGINT, syscall.SIGTERM)
	defer signal.Stop(sig)
	select {
	case <-sig:
	case err := <-serveDone:
		if !errors.Is(err, http.ErrServerClosed) {
			fmt.Fprintln(stderr, err)
			cancel()
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
	app.Close()
	return 0
}
