package gitdiff

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"testing"

	"github.com/markport/markport/internal/files"
)

func TestFingerprintFileIdentity(t *testing.T) {
	f := newFileHistoryFixture(t)
	f.write("file.txt", "base\n")
	f.commit("initial")
	f.write("file.txt", "edit\n")
	revision := func() string {
		t.Helper()
		list, err := List(context.Background(), f.store)
		if err != nil || len(list.Changes) != 1 {
			t.Fatalf("list: %+v %v", list, err)
		}
		return list.Changes[0].Revision
	}
	first := revision()
	if revision() != first {
		t.Fatal("unchanged file changed revision")
	}
	full := filepath.Join(f.dir, "file.txt")
	original, err := os.Stat(full)
	if err != nil {
		t.Fatal(err)
	}
	for _, content := range []string{"same\n", "longer edit\n"} {
		f.write("file.txt", content)
		if err := os.Chtimes(full, original.ModTime(), original.ModTime()); err != nil {
			t.Fatal(err)
		}
		next := revision()
		if next == first {
			t.Fatal("restored mtime concealed content change")
		}
		first = next
	}
	if runtime.GOOS != "windows" {
		if err := os.Chmod(full, 0700); err != nil {
			t.Fatal(err)
		}
		next := revision()
		if next == first {
			t.Fatal("mode change concealed")
		}
		first = next
	}
	f.git("add", "file.txt")
	if revision() == first {
		t.Fatal("staging change concealed")
	}
	// Atomic replacement with the same size and mtime must not hit the old hash.
	f.write("replacement", "replacement\n")
	if err := os.Rename(filepath.Join(f.dir, "replacement"), full); err != nil {
		t.Fatal(err)
	}
	if err := os.Chtimes(full, original.ModTime(), original.ModTime()); err != nil {
		t.Fatal(err)
	}
	if revision() == first {
		t.Fatal("replacement concealed")
	}
}

func TestBatchedHeadBlobs(t *testing.T) {
	f := newFileHistoryFixture(t)
	for i := 0; i < 510; i++ {
		f.write(fmt.Sprintf("nested/file-%03d [literal] 日本語.txt", i), fmt.Sprintf("base %d\n", i))
	}
	if runtime.GOOS != "windows" {
		f.write("nested/tab\tname.txt", "tab base\n")
	}
	base := f.commit("initial")
	for i := 0; i < 510; i++ {
		f.write(fmt.Sprintf("nested/file-%03d [literal] 日本語.txt", i), "changed\n")
	}
	if runtime.GOOS != "windows" {
		f.write("nested/tab\tname.txt", "tab changed\n")
	}
	// A browsed subdirectory exercises repository prefixes as well as batching.
	store, err := files.New(filepath.Join(f.dir, "nested"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	listing, err := ListAt(context.Background(), store, base)
	expected := 510
	if runtime.GOOS != "windows" {
		expected++
	}
	if err != nil || len(listing.Changes) != expected {
		t.Fatalf("list: %d %v", len(listing.Changes), err)
	}
	repo, _, err := discover(context.Background(), store)
	if err != nil {
		t.Fatal(err)
	}
	for _, change := range listing.Changes {
		blob, err := run(context.Background(), repo.root, "rev-parse", base+":"+repo.path(change.Path))
		if err != nil {
			t.Fatal(err)
		}
		want := change
		if err := fingerprint(context.Background(), store, &want, string(blob)); err != nil {
			t.Fatal(err)
		}
		if want.Revision != change.Revision {
			t.Fatalf("wrong base blob: %s", change.Path)
		}
	}
}

func TestSingleFileCollectionParity(t *testing.T) {
	f := newFileHistoryFixture(t)
	for _, name := range []string{"modified", "deleted", "cancelled", "unchanged", "recreated"} {
		f.write(name, "old\n")
	}
	base := f.commit("base")
	f.write("modified", "committed\n")
	f.commit("second")
	f.write("modified", "new\n")
	f.write("added", "new\n")
	f.git("rm", "-q", "deleted", "recreated")
	f.write("recreated", "old\n")
	f.write("cancelled", "staged\n")
	f.git("add", "cancelled")
	f.write("cancelled", "old\n")
	f.write("gone", "staged\n")
	f.git("add", "gone")
	if err := os.Remove(filepath.Join(f.dir, "gone")); err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	for _, baseID := range []string{"", base} {
		repo, _, err := discover(ctx, f.store)
		if err != nil {
			t.Fatal(err)
		}
		repo, _, err = resolveBase(ctx, repo, baseID)
		if err != nil {
			t.Fatal(err)
		}
		all, err := collect(ctx, f.store, repo, false, "")
		if err != nil {
			t.Fatal(err)
		}
		for _, change := range all {
			one, err := collect(ctx, f.store, repo, false, change.Path)
			if err != nil || len(one) != 1 || !reflect.DeepEqual(one[0], change) {
				t.Fatalf("%s: one=%+v all=%+v err=%v", change.Path, one, change, err)
			}
			got, err := FileAt(ctx, f.store, baseID, change.Path)
			if err != nil {
				t.Fatal(err)
			}
			want := Diff{Path: change.Path, Kind: "text"}
			if !change.noNetChange {
				want, err = changeDiff(ctx, f.store, repo, change.Path, change.Status)
				if err != nil {
					t.Fatal(err)
				}
			}
			if got != want {
				t.Fatalf("%s: got=%+v want=%+v", change.Path, got, want)
			}
		}
		if _, err := FileAt(ctx, f.store, baseID, "unchanged"); !errors.Is(err, ErrNoChange) {
			t.Fatalf("unchanged: %v", err)
		}
	}
}
