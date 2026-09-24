package files

import (
	"io/fs"
	"log"
	"os"
	"path"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
)

type Watcher struct {
	store    *Store
	w        *fsnotify.Watcher
	watched  map[string]os.FileInfo
	publish  func(string)
	done     chan struct{}
	once     sync.Once
	failed   bool
	snapshot map[string]os.FileInfo
}

func NewWatcher(store *Store, publish func(string)) (*Watcher, error) {
	w, err := fsnotify.NewWatcher()
	if err != nil {
		return nil, err
	}
	v := &Watcher{store: store, w: w, watched: make(map[string]os.FileInfo), publish: publish, done: make(chan struct{})}
	if err := v.register(""); err != nil {
		w.Close()
		return nil, err
	}
	if runtime.GOOS == "windows" {
		v.snapshot, err = v.snapshotTree()
		if err != nil {
			w.Close()
			return nil, err
		}
	}
	go v.run()
	return v, nil
}
func (v *Watcher) Close() error {
	var err error
	v.once.Do(func() { err = v.w.Close(); <-v.done })
	return err
}

func (v *Watcher) register(rel string) error {
	f, err := v.store.OpenDir(rel)
	if err != nil {
		return err
	}
	defer f.Close()
	abs := filepath.Join(v.store.Path, filepath.FromSlash(rel))
	opened, err := f.Stat()
	if err != nil {
		return err
	}
	if _, ok := v.watched[abs]; !ok {
		info, err := os.Lstat(abs)
		if err != nil || !info.IsDir() || info.Mode()&fs.ModeSymlink != 0 || !os.SameFile(opened, info) {
			return ErrType
		}
		if err := v.w.Add(abs); err != nil {
			return err
		}
		v.watched[abs] = opened
	}
	if runtime.GOOS == "windows" {
		// Windows does not allow renaming a directory while a descendant is
		// watched, even when the watch handle shares delete access.
		return nil
	}
	entries, err := f.ReadDir(-1)
	if err != nil {
		return err
	}
	for _, e := range entries {
		if Excluded(e.Name()) {
			continue
		}
		child := path.Join(rel, e.Name())
		info, err := v.store.root.Lstat(child)
		if err != nil || !info.IsDir() || info.Mode()&fs.ModeSymlink != 0 {
			continue
		}
		if err := v.register(child); err != nil {
			v.failed = true
			log.Printf("markport watcher: %v", err)
			v.publish("watch-error")
		}
	}
	return nil
}

func (v *Watcher) snapshotTree() (map[string]os.FileInfo, error) {
	nodes, err := v.store.Tree()
	if err != nil {
		return nil, err
	}
	snapshot := make(map[string]os.FileInfo)
	var visit func([]Node)
	visit = func(nodes []Node) {
		for _, node := range nodes {
			if node.Type == "directory" {
				snapshot[node.Path] = nil
				visit(node.Children)
				continue
			}
			f, err := v.store.Open(node.Path)
			if err != nil {
				continue
			}
			info, err := f.Stat()
			_ = f.Close()
			if err == nil {
				snapshot[node.Path] = info
			}
		}
	}
	visit(nodes)
	return snapshot, nil
}

func snapshotsDiffer(a, b map[string]os.FileInfo) bool {
	if len(a) != len(b) {
		return true
	}
	for name, previous := range a {
		current, ok := b[name]
		if !ok || (previous == nil) != (current == nil) {
			return true
		}
		if previous != nil && (!os.SameFile(previous, current) || previous.Size() != current.Size() || !previous.ModTime().Equal(current.ModTime())) {
			return true
		}
	}
	return false
}
func (v *Watcher) reconcile(event string) {
	previousFailure := v.failed
	v.failed = false
	for abs, opened := range v.watched {
		info, err := os.Lstat(abs)
		if err != nil || !info.IsDir() || info.Mode()&fs.ModeSymlink != 0 || !os.SameFile(opened, info) {
			_ = v.w.Remove(abs)
			delete(v.watched, abs)
		}
	}
	if err := v.register(""); err != nil {
		v.failed = true
		log.Printf("markport watcher: %v", err)
		v.publish("watch-error")
	}
	if previousFailure && !v.failed {
		v.publish("watch-ok")
	}
	v.publish(event)
}
func (v *Watcher) handleError(err error) {
	v.failed = true
	log.Printf("markport watcher: %v", err)
	v.publish("watch-error")
	v.reconcile("refresh")
}
func (v *Watcher) run() {
	defer close(v.done)
	retry := time.NewTicker(2 * time.Second)
	defer retry.Stop()
	var scan *time.Ticker
	var scanC <-chan time.Time
	if runtime.GOOS == "windows" {
		scan = time.NewTicker(500 * time.Millisecond)
		scanC = scan.C
		defer scan.Stop()
	}
	var timer *time.Timer
	defer func() {
		if timer != nil {
			timer.Stop()
		}
	}()
	var timerC <-chan time.Time
	pending := ""
	for {
		select {
		case event, ok := <-v.w.Events:
			if !ok {
				return
			}
			if !strings.HasPrefix(event.Name, v.store.Path) {
				continue
			}
			kind := "refresh"
			switch {
			case event.Op&fsnotify.Create != 0:
				kind = "created"
			case event.Op&(fsnotify.Remove|fsnotify.Rename) != 0:
				kind = "deleted"
			case event.Op&(fsnotify.Write|fsnotify.Chmod) != 0:
				kind = "changed"
			}
			if pending == "" {
				pending = kind
			} else if pending != kind {
				pending = "refresh"
			}
			if timer == nil {
				timer = time.NewTimer(80 * time.Millisecond)
				timerC = timer.C
			}
		case err, ok := <-v.w.Errors:
			if !ok {
				return
			}
			v.handleError(err)
		case <-timerC:
			v.reconcile(pending)
			timerC = nil
			timer = nil
			pending = ""
		case <-retry.C:
			if v.failed {
				v.reconcile("refresh")
			}
		case <-scanC:
			current, err := v.snapshotTree()
			if err != nil {
				v.handleError(err)
				continue
			}
			if snapshotsDiffer(v.snapshot, current) {
				v.snapshot = current
				v.reconcile("refresh")
			}
		}
	}
}
