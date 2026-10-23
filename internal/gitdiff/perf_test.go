package gitdiff

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"github.com/markport/markport/internal/files"
)

func BenchmarkListAt(b *testing.B) {
	dir := b.TempDir()
	git := func(args ...string) {
		b.Helper()
		if out, err := exec.Command("git", append([]string{"-C", dir}, args...)...).CombinedOutput(); err != nil {
			b.Fatalf("git: %v: %s", err, out)
		}
	}
	write := func(i int, text string) {
		b.Helper()
		if err := os.WriteFile(filepath.Join(dir, fmt.Sprintf("file-%03d.txt", i)), []byte(text), 0600); err != nil {
			b.Fatal(err)
		}
	}
	git("init", "-q")
	git("config", "user.email", "perf@example.com")
	git("config", "user.name", "Perf")
	for i := 0; i < 40; i++ {
		write(i, "old\n")
	}
	git("add", ".")
	git("commit", "-qm", "initial")
	for i := 0; i < 50; i++ {
		if i < 10 {
			if err := os.Remove(filepath.Join(dir, fmt.Sprintf("file-%03d.txt", i))); err != nil {
				b.Fatal(err)
			}
		} else {
			write(i, "new\n")
		}
	}
	git("add", "file-010.txt", "file-040.txt")
	store, err := files.New(dir)
	if err != nil {
		b.Fatal(err)
	}
	defer store.Close()
	// Model steady polling: populate the existing line-count cache first.
	if _, err := ListAt(context.Background(), store, ""); err != nil {
		b.Fatal(err)
	}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		listing, err := ListAt(context.Background(), store, "")
		if err != nil || len(listing.Changes) != 50 {
			b.Fatalf("listing: %v, %d", err, len(listing.Changes))
		}
	}
}
