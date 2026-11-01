package files

import (
	"encoding/binary"
	"fmt"
	"path/filepath"
	"strings"
	"sync"
	"unicode/utf16"

	"github.com/fsnotify/fsnotify"
	"golang.org/x/sys/windows"
)

// Windows cannot rename a directory while handles to its descendants are open.
// Keep one recursive handle at the browsing root, rather than one per folder.
// The logical directory list still enforces WatchOptions.MaxDirs in Watcher.
type windowsWatchBackend struct {
	mu          sync.Mutex
	root        string
	directories map[string]bool
	watches     map[string]*windowsDirectoryWatch
	events      chan fsnotify.Event
	errors      chan error
	closed      bool
}

type windowsDirectoryWatch struct {
	mu      sync.Mutex
	handle  windows.Handle
	pending windows.Overlapped
	buffer  [65536]byte
	closed  bool
	done    chan struct{}
	stopped chan struct{}
	path    string
	recurse bool
}

func newNativeWatcher(root string) (*nativeWatcher, error) {
	w := &windowsWatchBackend{
		root: root, directories: make(map[string]bool), watches: make(map[string]*windowsDirectoryWatch),
		events: make(chan fsnotify.Event, 256), errors: make(chan error, 1),
	}
	return &nativeWatcher{watchBackend: w, Events: w.events, Errors: w.errors}, nil
}

func (w *windowsWatchBackend) Add(path string) error {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.closed {
		return fsnotify.ErrClosed
	}
	if w.directories[path] {
		return nil
	}
	relative, err := filepath.Rel(w.root, path)
	inside := err == nil && relative != ".." && !strings.HasPrefix(relative, `..\`)
	if !inside || relative == "." {
		s, err := startWindowsDirectoryWatch(path, inside)
		if err != nil {
			return err
		}
		w.watches[path] = s
		go s.run(w.events, w.errors)
	}
	w.directories[path] = true
	return nil
}

func (w *windowsWatchBackend) Remove(path string) error {
	w.mu.Lock()
	defer w.mu.Unlock()
	if s := w.watches[path]; s != nil {
		s.stop()
		delete(w.watches, path)
	}
	delete(w.directories, path)
	return nil
}

func (w *windowsWatchBackend) WatchList() []string {
	w.mu.Lock()
	defer w.mu.Unlock()
	paths := make([]string, 0, len(w.directories))
	for path := range w.directories {
		paths = append(paths, path)
	}
	return paths
}

func (w *windowsWatchBackend) Close() error {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.closed {
		return nil
	}
	w.closed = true
	for _, s := range w.watches {
		s.stop()
	}
	clear(w.watches)
	clear(w.directories)
	close(w.events)
	close(w.errors)
	return nil
}

func startWindowsDirectoryWatch(path string, recurse bool) (*windowsDirectoryWatch, error) {
	name, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return nil, err
	}
	handle, err := windows.CreateFile(name, windows.FILE_LIST_DIRECTORY,
		windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE|windows.FILE_SHARE_DELETE, nil,
		windows.OPEN_EXISTING, windows.FILE_FLAG_BACKUP_SEMANTICS|windows.FILE_FLAG_OVERLAPPED, 0)
	if err != nil {
		return nil, err
	}
	event, err := windows.CreateEvent(nil, 0, 0, nil)
	if err != nil {
		windows.CloseHandle(handle)
		return nil, err
	}
	s := &windowsDirectoryWatch{handle: handle, pending: windows.Overlapped{HEvent: event}, path: path, recurse: recurse, done: make(chan struct{}), stopped: make(chan struct{})}
	// Arm the watch before returning so startup cannot miss the first mutation.
	if err := s.read(); err != nil {
		windows.CloseHandle(event)
		windows.CloseHandle(handle)
		return nil, err
	}
	return s, nil
}

func (s *windowsDirectoryWatch) read() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return windows.ERROR_OPERATION_ABORTED
	}
	const mask = windows.FILE_NOTIFY_CHANGE_FILE_NAME | windows.FILE_NOTIFY_CHANGE_DIR_NAME | windows.FILE_NOTIFY_CHANGE_SIZE | windows.FILE_NOTIFY_CHANGE_LAST_WRITE
	return windows.ReadDirectoryChanges(s.handle, &s.buffer[0], uint32(len(s.buffer)), s.recurse, mask, nil, &s.pending, 0)
}

func (s *windowsDirectoryWatch) stop() {
	s.mu.Lock()
	if !s.closed {
		s.closed = true
		close(s.done)
		// Serialized with submission to avoid cancelling just before a new read.
		_ = windows.CancelIoEx(s.handle, &s.pending)
	}
	s.mu.Unlock()
	<-s.stopped
}

func (s *windowsDirectoryWatch) run(events chan<- fsnotify.Event, errors chan<- error) {
	defer close(s.stopped)
	defer func() {
		s.mu.Lock()
		if !s.closed {
			s.closed = true
			close(s.done)
		}
		_ = windows.CancelIoEx(s.handle, &s.pending)
		s.mu.Unlock()
		// Keep the OVERLAPPED and its buffer alive until cancelled I/O finishes.
		var size uint32
		_ = windows.GetOverlappedResult(s.handle, &s.pending, &size, true)
		windows.CloseHandle(s.handle)
		windows.CloseHandle(s.pending.HEvent)
	}()
	report := func(err error) {
		select {
		case errors <- err:
		case <-s.done:
		}
	}
	for {
		var size uint32
		if err := windows.GetOverlappedResult(s.handle, &s.pending, &size, true); err != nil {
			report(err)
			return
		}
		if size == 0 {
			report(fsnotify.ErrEventOverflow)
			return
		}
		batch, err := windowsChangeEvents(s.path, s.buffer[:size])
		if err != nil {
			report(err)
			return
		}
		if err := s.read(); err != nil {
			report(err)
			return
		}
		for _, event := range batch {
			select {
			case events <- event:
			case <-s.done:
				return
			}
		}
	}
}

func windowsChangeEvents(root string, data []byte) ([]fsnotify.Event, error) {
	var events []fsnotify.Event
	for {
		if len(data) < 12 {
			return nil, fmt.Errorf("invalid Windows directory notification")
		}
		next := binary.LittleEndian.Uint32(data)
		action := binary.LittleEndian.Uint32(data[4:])
		length := binary.LittleEndian.Uint32(data[8:])
		if length%2 != 0 || uint64(length)+12 > uint64(len(data)) {
			return nil, fmt.Errorf("invalid Windows directory notification name")
		}
		name := make([]uint16, length/2)
		for i := range name {
			name[i] = binary.LittleEndian.Uint16(data[12+i*2:])
		}
		var op fsnotify.Op
		switch action {
		case windows.FILE_ACTION_ADDED, windows.FILE_ACTION_RENAMED_NEW_NAME:
			op = fsnotify.Create
		case windows.FILE_ACTION_REMOVED:
			op = fsnotify.Remove
		case windows.FILE_ACTION_RENAMED_OLD_NAME:
			op = fsnotify.Rename
		case windows.FILE_ACTION_MODIFIED:
			op = fsnotify.Write
		}
		if op != 0 {
			events = append(events, fsnotify.Event{Name: filepath.Join(root, string(utf16.Decode(name))), Op: op})
		}
		if next == 0 {
			return events, nil
		}
		if uint64(next) < uint64(length)+12 || uint64(next) > uint64(len(data)) {
			return nil, fmt.Errorf("invalid Windows directory notification offset")
		}
		data = data[next:]
	}
}
