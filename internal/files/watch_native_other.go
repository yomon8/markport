//go:build !windows

package files

import "github.com/fsnotify/fsnotify"

func newNativeWatcher(_ string) (*nativeWatcher, error) {
	w, err := fsnotify.NewWatcher()
	if err != nil {
		return nil, err
	}
	return &nativeWatcher{watchBackend: w, Events: w.Events, Errors: w.Errors}, nil
}
