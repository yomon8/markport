//go:build !linux && !windows

package files

import "testing"

func TestWatchUsesPollingOnUnsupportedPlatforms(t *testing.T) {
	store, err := New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	watcher, err := store.Watch(t.Context(), WatchOptions{})
	if err != nil || watcher.Mode() != "poll" {
		t.Fatalf("mode = %s, error = %v", watcher.Mode(), err)
	}
	defer watcher.Close()
	changes, unsubscribe := watcher.Subscribe()
	defer unsubscribe()
	if _, ok := <-changes; ok {
		t.Fatal("poll watcher should not retain subscriptions")
	}
}
