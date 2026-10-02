// Package discovery tracks Markport servers belonging to the current OS user.
package discovery

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/netip"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

type Record struct {
	ID   string `json:"id"`
	PID  int    `json:"pid"`
	Host string `json:"host"`
	Port int    `json:"port"`
}

type Info struct {
	RootPath string `json:"rootPath"`
	Version  string `json:"version"`
}

type Instance struct {
	Info
	Port              int    `json:"-"`
	URL               string `json:"url"`
	Current           bool   `json:"current"`
	UnavailableReason string `json:"unavailableReason,omitempty"`
}

type Registry struct{ Directory string }

func Default() (*Registry, error) {
	dir, err := os.UserCacheDir()
	if err != nil {
		return nil, err
	}
	return &Registry{Directory: filepath.Join(dir, "markport", "instances")}, nil
}

func (r *Registry) Register(record Record) (func(), error) {
	if !validRecord(record) {
		return nil, errors.New("invalid instance record")
	}
	if err := os.MkdirAll(r.Directory, 0700); err != nil {
		return nil, err
	}
	if err := os.Chmod(r.Directory, 0700); err != nil {
		return nil, err
	}
	data, err := json.Marshal(record)
	if err != nil {
		return nil, err
	}
	file, err := os.CreateTemp(r.Directory, ".register-*")
	if err != nil {
		return nil, err
	}
	temporary := file.Name()
	defer os.Remove(temporary)
	if _, err = file.Write(data); err != nil {
		file.Close()
		return nil, err
	}
	if err = file.Close(); err != nil {
		return nil, err
	}
	target := filepath.Join(r.Directory, record.ID+".json")
	if err = os.Rename(temporary, target); err != nil {
		return nil, err
	}
	return func() { _ = os.Remove(target) }, nil
}

func validRecord(record Record) bool {
	addr, err := netip.ParseAddr(record.Host)
	if err != nil || !addr.Is4() || record.Port < 1 || record.Port > 65535 || len(record.ID) != 32 || record.PID < 1 {
		return false
	}
	for _, c := range record.ID {
		if !strings.ContainsRune("0123456789abcdef", c) {
			return false
		}
	}
	return true
}

func Link(record Record, info Info, current bool, requestHost string) Instance {
	item := Instance{Info: info, Current: current, Port: record.Port}
	host, _, err := net.SplitHostPort(requestHost)
	if err != nil {
		host = requestHost
	}
	requestAddr, _ := netip.ParseAddr(host)
	local := strings.EqualFold(host, "localhost") || requestAddr.IsLoopback()
	addr, _ := netip.ParseAddr(record.Host)
	if addr.IsLoopback() && !local {
		item.UnavailableReason = "Local access only"
		return item
	}
	target := record.Host
	if target == "0.0.0.0" {
		target = host
	}
	item.URL = "http://" + net.JoinHostPort(target, strconv.Itoa(record.Port)) + "/"
	return item
}

// List only probes registered local addresses; it never follows redirects or proxies.
func (r *Registry) List(ctx context.Context, self Record, info Info, requestHost string) ([]Instance, error) {
	result := []Instance{Link(self, info, true, requestHost)}
	entries, err := os.ReadDir(r.Directory)
	if err != nil {
		if os.IsNotExist(err) {
			return result, nil
		}
		return result, err
	}
	addresses, err := net.InterfaceAddrs()
	if err != nil {
		return result, err
	}
	localAddresses := make(map[string]bool)
	for _, address := range addresses {
		if prefix, err := netip.ParsePrefix(address.String()); err == nil {
			localAddresses[prefix.Addr().String()] = true
		}
	}
	ctx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	transport := &http.Transport{DialContext: (&net.Dialer{Timeout: 500 * time.Millisecond}).DialContext}
	defer transport.CloseIdleConnections()
	client := &http.Client{Transport: transport, Timeout: 500 * time.Millisecond, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	jobs := make(chan Record)
	var mu sync.Mutex
	var workers sync.WaitGroup
	for range 8 {
		workers.Add(1)
		go func() {
			defer workers.Done()
			for record := range jobs {
				if ctx.Err() != nil {
					continue
				}
				host := record.Host
				if host == "0.0.0.0" {
					host = "127.0.0.1"
				}
				request, err := http.NewRequestWithContext(ctx, "GET", "http://"+net.JoinHostPort(host, strconv.Itoa(record.Port))+"/api/instance", nil)
				if err != nil {
					continue
				}
				response, err := client.Do(request)
				if err != nil {
					continue
				}
				var details Info
				err = json.NewDecoder(io.LimitReader(response.Body, 64*1024)).Decode(&details)
				response.Body.Close()
				if err != nil || response.StatusCode != http.StatusOK || response.Header.Get("X-Markport-Instance") != record.ID || details.RootPath == "" {
					continue
				}
				mu.Lock()
				result = append(result, Link(record, details, false, requestHost))
				mu.Unlock()
			}
		}()
	}
scan:
	for _, entry := range entries {
		if ctx.Err() != nil {
			break
		}
		if !entry.Type().IsRegular() || !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}
		file, err := os.Open(filepath.Join(r.Directory, entry.Name()))
		if err != nil {
			continue
		}
		var record Record
		err = json.NewDecoder(io.LimitReader(file, 4096)).Decode(&record)
		file.Close()
		if err != nil || !validRecord(record) || entry.Name() != record.ID+".json" || record.ID == self.ID {
			continue
		}
		addr, _ := netip.ParseAddr(record.Host)
		if !addr.IsLoopback() && !addr.IsUnspecified() && !localAddresses[record.Host] {
			continue
		}
		select {
		case jobs <- record:
		case <-ctx.Done():
			break scan
		}
	}
	close(jobs)
	workers.Wait()
	sort.Slice(result[1:], func(i, j int) bool {
		a, b := result[i+1], result[j+1]
		if a.RootPath != b.RootPath {
			return a.RootPath < b.RootPath
		}
		if a.Port != b.Port {
			return a.Port < b.Port
		}
		return a.URL < b.URL
	})
	if ctx.Err() != nil {
		return result, errors.New("instance discovery timed out")
	}
	return result, nil
}
