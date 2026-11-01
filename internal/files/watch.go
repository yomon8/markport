package files

import (
	"context"
	"fmt"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/fsnotify/fsnotify"
)

const MaxWatchDirs = 8192
const MaxChangePaths = 256

type ChangeKind uint8

const (
	Write ChangeKind = iota + 1
	Create
	Remove
	Rename
)

type ChangeBatch struct {
	Paths    []string `json:"paths"`
	Overflow bool     `json:"overflow"`
	Git      bool     `json:"git"`
	Created  bool     `json:"created"`
}

type WatchOptions struct {
	ExtraDirs []string
	MaxDirs   int
	Debounce  time.Duration
}

type extraWatchRequest struct {
	ctx         context.Context
	directories []string
	result      chan error
}

type watchBackend interface {
	Add(string) error
	Remove(string) error
	WatchList() []string
	Close() error
}

type nativeWatcher struct {
	watchBackend
	Events chan fsnotify.Event
	Errors chan error
}

// Watcher owns a complete set of directory watches, or falls back to polling.
// The event loop owns directories; mu protects subscribers and shutdown.
type Watcher struct {
	store         *Store
	native        *nativeWatcher
	opts          WatchOptions
	directories   map[string]bool
	extra         map[string]bool
	mode          atomic.Value
	cancel        context.CancelFunc
	done          chan struct{}
	closeErr      error
	mu            sync.Mutex
	closed        bool
	nextID        uint64
	subscribers   map[uint64]chan ChangeBatch
	extraRequests chan extraWatchRequest
}

func (s *Store) Watch(ctx context.Context, opts WatchOptions) (*Watcher, error) {
	if opts.MaxDirs <= 0 || opts.MaxDirs > MaxWatchDirs {
		opts.MaxDirs = MaxWatchDirs
	}
	if opts.Debounce <= 0 {
		opts.Debounce = 200 * time.Millisecond
	}
	ctx, cancel := context.WithCancel(ctx)
	w := &Watcher{store: s, opts: opts, directories: make(map[string]bool), extra: make(map[string]bool), cancel: cancel, done: make(chan struct{}), subscribers: make(map[uint64]chan ChangeBatch), extraRequests: make(chan extraWatchRequest)}
	w.mode.Store("poll")
	if !watchSupported {
		w.finish()
		return w, nil
	}
	native, err := newNativeWatcher(s.Path)
	if err == nil {
		w.native = native
		err = w.addTree(ctx, "")
	}
	if err == nil {
		for _, directory := range opts.ExtraDirs {
			if err = ctx.Err(); err != nil {
				break
			}
			if err = w.addExtra(directory); err != nil {
				break
			}
		}
	}
	if err == nil {
		err = ctx.Err()
	}
	if err != nil {
		w.finish()
		return w, err
	}
	w.mode.Store("watch")
	go w.loop(ctx)
	return w, nil
}

func (w *Watcher) Mode() string { return w.mode.Load().(string) }

// AddExtraDirs registers metadata for repositories created after startup.
// Registration stays serialized with filesystem events and shares their limit.
func (w *Watcher) AddExtraDirs(ctx context.Context, directories []string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if len(directories) == 0 {
		return nil
	}
	if w.Mode() != "watch" {
		return os.ErrClosed
	}
	request := extraWatchRequest{ctx: ctx, directories: append([]string{}, directories...), result: make(chan error, 1)}
	select {
	case w.extraRequests <- request:
	case <-ctx.Done():
		return ctx.Err()
	case <-w.done:
		return os.ErrClosed
	}
	select {
	case err := <-request.result:
		return err
	case <-ctx.Done():
		return ctx.Err()
	case <-w.done:
		select {
		case err := <-request.result:
			return err
		default:
			return os.ErrClosed
		}
	}
}

func (w *Watcher) Close() error {
	w.cancel()
	<-w.done
	return w.closeErr
}

func (w *Watcher) Subscribe() (<-chan ChangeBatch, func()) {
	w.mu.Lock()
	defer w.mu.Unlock()
	channel := make(chan ChangeBatch, 8)
	if w.closed {
		close(channel)
		return channel, func() {}
	}
	w.nextID++
	id := w.nextID
	w.subscribers[id] = channel
	var once sync.Once
	return channel, func() {
		once.Do(func() {
			w.mu.Lock()
			defer w.mu.Unlock()
			if current, ok := w.subscribers[id]; ok {
				delete(w.subscribers, id)
				close(current)
			}
		})
	}
}

func (w *Watcher) finish() {
	w.cancel()
	w.mode.Store("poll")
	if w.native != nil {
		w.closeErr = w.native.Close()
	}
	w.mu.Lock()
	w.closed = true
	for id, channel := range w.subscribers {
		close(channel)
		delete(w.subscribers, id)
	}
	w.mu.Unlock()
	close(w.done)
}

func (w *Watcher) publish(batch ChangeBatch) {
	w.mu.Lock()
	defer w.mu.Unlock()
	for _, channel := range w.subscribers {
		copy := batch
		copy.Paths = append([]string{}, batch.Paths...)
		select {
		case channel <- copy:
		default:
			// A slow subscriber must not block other clients or lose freshness.
		drain:
			for {
				select {
				case <-channel:
				default:
					break drain
				}
			}
			copy.Overflow = true
			channel <- copy
		}
	}
}

func (w *Watcher) addDirectory(directory string) error {
	if w.directories[directory] {
		return nil
	}
	if len(w.directories) >= w.opts.MaxDirs {
		return fmt.Errorf("watch directory limit (%d) exceeded", w.opts.MaxDirs)
	}
	if err := w.native.Add(directory); err != nil {
		return fmt.Errorf("watch %s: %w", directory, err)
	}
	w.directories[directory] = true
	return nil
}

func (w *Watcher) addTree(ctx context.Context, relative string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	directory := filepath.Join(w.store.Path, filepath.FromSlash(relative))
	if w.directories[directory] {
		return nil
	}
	file, err := w.store.OpenDir(relative)
	if err != nil {
		return err
	}
	defer file.Close()
	before, err := file.Stat()
	if err != nil {
		return err
	}
	if err := w.addDirectory(directory); err != nil {
		return err
	}
	// Detect replacement between Store's safe open and fsnotify's path-based Add.
	after, err := w.store.DirectoryVersion(relative)
	if err != nil || !os.SameFile(before, after) {
		return fmt.Errorf("watch directory changed during registration: %s", relative)
	}
	entries, err := file.ReadDir(-1)
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if err := ctx.Err(); err != nil {
			return err
		}
		if Excluded(entry.Name()) {
			continue
		}
		child := path.Join(relative, entry.Name())
		info, err := w.store.root.Lstat(child)
		if err != nil || info.Mode()&(fs.ModeSymlink|fs.ModeIrregular) != 0 || !info.IsDir() {
			continue
		}
		if err := w.addTree(ctx, child); err != nil {
			return err
		}
	}
	return nil
}

func (w *Watcher) addExtra(directory string) error {
	absolute, err := filepath.Abs(directory)
	if err != nil {
		return err
	}
	before, err := os.Lstat(absolute)
	if err != nil {
		return err
	}
	if !before.IsDir() || before.Mode()&os.ModeSymlink != 0 {
		return ErrType
	}
	if err := w.addDirectory(absolute); err != nil {
		return err
	}
	after, err := os.Lstat(absolute)
	if err != nil || !os.SameFile(before, after) || after.Mode()&os.ModeSymlink != 0 {
		return fmt.Errorf("extra watch directory changed: %s", absolute)
	}
	w.extra[absolute] = true
	return nil
}

func (w *Watcher) removeTree(directory string) {
	for watched := range w.directories {
		if watched == directory || strings.HasPrefix(watched, directory+string(filepath.Separator)) {
			_ = w.native.Remove(watched) // fsnotify may already have removed it.
			delete(w.directories, watched)
		}
	}
}

func (w *Watcher) loop(ctx context.Context) {
	defer w.finish()
	paths := make(map[string]bool)
	batch := ChangeBatch{}
	var timer *time.Timer
	var tick <-chan time.Time
	defer func() {
		if timer != nil {
			timer.Stop()
		}
	}()
	flush := func() {
		batch.Paths = make([]string, 0, len(paths))
		for name := range paths {
			batch.Paths = append(batch.Paths, name)
		}
		sort.Strings(batch.Paths)
		w.publish(batch)
		paths = make(map[string]bool)
		batch = ChangeBatch{}
		tick = nil
	}
	fallback := func() {
		w.mode.Store("poll")
		batch.Overflow = true
		flush()
	}
	armTimer := func() {
		if timer == nil {
			timer = time.NewTimer(w.opts.Debounce)
		} else {
			timer.Stop()
			timer.Reset(w.opts.Debounce)
		}
		tick = timer.C
	}
	for {
		select {
		case <-ctx.Done():
			return
		case <-tick:
			flush()
		case request := <-w.extraRequests:
			if err := request.ctx.Err(); err != nil {
				request.result <- err
				continue
			}
			var err error
			for _, directory := range request.directories {
				if err = w.addExtra(directory); err != nil {
					break
				}
			}
			request.result <- err
			if err != nil {
				fallback()
				return
			}
			batch.Git = true
			armTimer()
		case _, ok := <-w.native.Errors:
			if !ok && ctx.Err() != nil {
				return
			}
			fallback()
			return
		case event, ok := <-w.native.Events:
			if !ok {
				fallback()
				return
			}
			if event.Op&(fsnotify.Write|fsnotify.Create|fsnotify.Remove|fsnotify.Rename) == 0 {
				continue
			}
			name := filepath.Clean(event.Name)
			if (name == w.store.Path || w.extra[name]) && event.Op&(fsnotify.Remove|fsnotify.Rename) != 0 {
				fallback()
				return
			}
			if w.extra[filepath.Dir(name)] {
				batch.Git = true
			} else {
				relative, err := filepath.Rel(w.store.Path, name)
				if err != nil {
					continue
				}
				relative = filepath.ToSlash(relative)
				if _, err := Parts(relative); err != nil {
					continue
				}
				info, err := w.store.root.Lstat(relative)
				if err == nil && (info.Mode()&fs.ModeSymlink != 0 || !info.IsDir() && !info.Mode().IsRegular()) {
					continue
				}
				// NTFS also reports parent-directory writes for child changes.
				// Those contain no additional content or structural information.
				if err == nil && info.IsDir() && event.Op&(fsnotify.Write|fsnotify.Create|fsnotify.Remove|fsnotify.Rename) == fsnotify.Write {
					continue
				}
				if event.Op&fsnotify.Create != 0 && err == nil && info.IsDir() {
					if err := w.addTree(ctx, relative); err != nil {
						fallback()
						return
					}
				}
				if event.Op&(fsnotify.Remove|fsnotify.Rename) != 0 {
					w.removeTree(name)
				}
				if !paths[relative] {
					if len(paths) < MaxChangePaths {
						paths[relative] = true
					} else {
						batch.Overflow = true
					}
				}
				batch.Created = batch.Created || event.Op&(fsnotify.Create|fsnotify.Remove|fsnotify.Rename) != 0
			}
			armTimer()
		}
	}
}
