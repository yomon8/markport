package server

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"path"
	"time"

	"github.com/markport/markport/internal/files"
	"github.com/markport/markport/internal/gitdiff"
)

const maxEventClients = 32

// StartWatch initializes watches off the startup path. Errors are nonfatal;
// until initialization succeeds, events reports polling mode.
func (s *Server) StartWatch(ctx context.Context) <-chan error {
	s.watchOnce.Do(func() {
		watchCtx, cancel := context.WithCancel(ctx)
		s.watchMu.Lock()
		s.watchCancel = cancel
		s.watchDone = make(chan struct{})
		s.watchErrors = make(chan error, 1)
		done, failures := s.watchDone, s.watchErrors
		s.watchMu.Unlock()
		go func() {
			defer close(done)
			defer close(failures)
			defer s.closeEventSubscribers()
			directories, err := gitdiff.WatchDirs(watchCtx, s.Files)
			if err != nil {
				if !errors.Is(err, context.Canceled) {
					failures <- err
				}
				return
			}
			watcher, err := s.Files.Watch(watchCtx, files.WatchOptions{ExtraDirs: directories})
			if watcher != nil {
				defer watcher.Close()
			}
			if err != nil {
				if !errors.Is(err, context.Canceled) {
					failures <- err
				}
				return
			}
			changes, unsubscribe := watcher.Subscribe()
			defer unsubscribe()
			s.watchMu.Lock()
			s.watcher = watcher
			s.gitWatchReady = len(directories) > 0
			s.watchMu.Unlock()
			for {
				select {
				case <-watchCtx.Done():
					return
				case batch, ok := <-changes:
					if !ok {
						return
					}
					invalidate := batch.Created || batch.Overflow || batch.Git
					for _, name := range batch.Paths {
						invalidate = invalidate || path.Base(name) == ".gitignore"
					}
					if invalidate {
						s.invalidateSearch()
					}
					s.publishChange(batch)
				}
			}
		}()
	})
	s.watchMu.RLock()
	failures := s.watchErrors
	s.watchMu.RUnlock()
	return failures
}

func (s *Server) StopWatch() {
	s.watchMu.RLock()
	cancel, done := s.watchCancel, s.watchDone
	s.watchMu.RUnlock()
	if cancel != nil {
		cancel()
	}
	if done != nil {
		<-done
	}
}

func (s *Server) ensureGitWatch(ctx context.Context) {
	s.gitWatchMu.Lock()
	defer s.gitWatchMu.Unlock()
	s.watchMu.RLock()
	watcher, ready := s.watcher, s.gitWatchReady
	s.watchMu.RUnlock()
	if ready || watcher == nil || watcher.Mode() != "watch" {
		return
	}
	directories, err := gitdiff.WatchDirs(ctx, s.Files)
	if err != nil {
		if !errors.Is(err, context.Canceled) && !errors.Is(err, context.DeadlineExceeded) {
			_ = watcher.Close()
		}
		return
	}
	if len(directories) == 0 || watcher.AddExtraDirs(ctx, directories) != nil {
		return
	}
	s.watchMu.Lock()
	s.gitWatchReady = true
	s.watchMu.Unlock()
}

func (s *Server) invalidateSearch() {
	s.searchMu.Lock()
	s.searchExpires = time.Time{}
	s.searchGeneration++
	s.searchMu.Unlock()
}

func (s *Server) subscribeEvents() (<-chan files.ChangeBatch, func()) {
	s.watchMu.Lock()
	defer s.watchMu.Unlock()
	changes := make(chan files.ChangeBatch, 8)
	if s.watcher == nil || s.watcher.Mode() != "watch" {
		close(changes)
		return changes, func() {}
	}
	if s.eventSubscribers == nil {
		s.eventSubscribers = make(map[uint64]chan files.ChangeBatch)
	}
	s.nextEventSubscriber++
	id := s.nextEventSubscriber
	s.eventSubscribers[id] = changes
	return changes, func() {
		s.watchMu.Lock()
		defer s.watchMu.Unlock()
		if channel, ok := s.eventSubscribers[id]; ok {
			delete(s.eventSubscribers, id)
			close(channel)
		}
	}
}

// Cache invalidation happens before this broadcast, so clients reacting to an
// event cannot reuse an index known to predate that event.
func (s *Server) publishChange(batch files.ChangeBatch) {
	s.watchMu.Lock()
	defer s.watchMu.Unlock()
	for _, channel := range s.eventSubscribers {
		outgoing := batch
		outgoing.Paths = append([]string{}, batch.Paths...)
		select {
		case channel <- outgoing:
		default:
		drain:
			for {
				select {
				case <-channel:
				default:
					break drain
				}
			}
			outgoing.Overflow = true
			channel <- outgoing
		}
	}
}

func (s *Server) closeEventSubscribers() {
	s.watchMu.Lock()
	defer s.watchMu.Unlock()
	for id, channel := range s.eventSubscribers {
		close(channel)
		delete(s.eventSubscribers, id)
	}
}

func (s *Server) events(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unavailable", http.StatusInternalServerError)
		return
	}
	if s.eventClients.Add(1) > maxEventClients {
		s.eventClients.Add(-1)
		http.Error(w, "too many event connections", http.StatusServiceUnavailable)
		return
	}
	defer s.eventClients.Add(-1)
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-store")
	controller := http.NewResponseController(w)
	defer controller.SetWriteDeadline(time.Time{})
	writeEvent := func(name string, value any) bool {
		data, err := json.Marshal(value)
		if err != nil {
			return false
		}
		// Bound writes to slow clients so shutdown can finish promptly.
		_ = controller.SetWriteDeadline(time.Now().Add(2 * time.Second))
		if _, err := fmt.Fprintf(w, "event: %s\ndata: %s\n\n", name, data); err != nil {
			return false
		}
		flusher.Flush()
		return true
	}
	mode := func(value string) bool { return writeEvent("mode", map[string]string{"mode": value}) }
	s.watchMu.RLock()
	watcher := s.watcher
	s.watchMu.RUnlock()
	if watcher == nil || watcher.Mode() != "watch" {
		mode("poll")
		return
	}
	changes, unsubscribe := s.subscribeEvents()
	defer unsubscribe()
	if !mode(watcher.Mode()) || watcher.Mode() != "watch" {
		return
	}
	ticker := time.NewTicker(25 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case batch, ok := <-changes:
			if !ok {
				mode("poll")
				return
			}
			if !writeEvent("change", batch) {
				return
			}
			if watcher.Mode() != "watch" {
				mode("poll")
				return
			}
		case <-ticker.C:
			_ = controller.SetWriteDeadline(time.Now().Add(2 * time.Second))
			if _, err := fmt.Fprint(w, ": ping\n\n"); err != nil {
				return
			}
			flusher.Flush()
		}
	}
}
