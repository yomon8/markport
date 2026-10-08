package gitdiff

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/markport/markport/internal/files"
)

func TestLocalChanges(t *testing.T) {
	output := []byte("M  staged\x00 M unstaged\x00MM mixed\x00?? new\x00D  recreated\x00?? recreated\x00 A intent\x00 M 日本語\n file\x00")
	for _, code := range []string{"DD", "AU", "UD", "UA", "DU", "AA", "UU"} {
		output = append(output, []byte(code+" "+code+"\x00")...)
	}
	changes, err := localChanges(output)
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]string{"staged": "staged", "unstaged": "unstaged", "mixed": "mixed", "new": "untracked", "recreated": "mixed", "intent": "unstaged", "日本語\n file": "unstaged"}
	for _, code := range []string{"DD", "AU", "UD", "UA", "DU", "AA", "UU"} {
		want[code] = "conflicted"
	}
	for name, staging := range want {
		if got := changes[name].staging(); got != staging {
			t.Errorf("%q = %q, want %q", name, got, staging)
		}
	}
	for name, want := range map[string][]string{"staged": {"M "}, "unstaged": {" M"}, "mixed": {"MM"}, "new": {"??"}, "recreated": {"D ", "??"}, "intent": {" A"}, "DU": {"DU"}, "AU": {"AU"}, "AA": {"AA"}, "日本語\n file": {" M"}} {
		if !slices.Equal(changes[name].statuses, want) {
			t.Errorf("%s statuses = %q, want %q", name, changes[name].statuses, want)
		}
	}
	if got := (localChange{}).staging(); got != "clean" {
		t.Fatal(got)
	}
	for _, output := range []string{" M file", "M\x00", " M \x00", "XX file\x00", "  file\x00", " M file\x00\x00"} {
		if _, err := localChanges([]byte(output)); err == nil {
			t.Errorf("accepted malformed status %q", output)
		}
	}
}

func TestStagingAndCancelledChanges(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("Git is unavailable")
	}
	dir := t.TempDir()
	git := func(args ...string) string {
		t.Helper()
		cmd := exec.Command("git", append([]string{"-C", dir}, args...)...)
		cmd.Env = append(os.Environ(), "GIT_CONFIG_NOSYSTEM=1", "GIT_CONFIG_GLOBAL="+os.DevNull)
		output, err := cmd.CombinedOutput()
		if err != nil {
			t.Fatalf("git %v: %v: %s", args, err, output)
		}
		return strings.TrimSpace(string(output))
	}
	write := func(name, value string) {
		t.Helper()
		if err := os.WriteFile(filepath.Join(dir, name), []byte(value), 0600); err != nil {
			t.Fatal(err)
		}
	}
	git("init", "-q")
	git("config", "user.name", "Test")
	git("config", "user.email", "test@example.com")
	for _, name := range []string{"staged", "unstaged", "mixed", "cancelled", "deleted", "renamed", "committed", "recreated"} {
		write(name, "old\n")
	}
	write(".gitignore", "ignored\n")
	git("add", ".")
	git("commit", "-qm", "base")
	base := git("rev-parse", "HEAD")
	write("committed", "committed\n")
	git("add", "committed")
	git("commit", "-qm", "second")
	for _, name := range []string{"staged", "unstaged", "mixed", "cancelled", "new-staged", "new-mixed", "new-gone", "new-untracked", "ignored", "日本語 file"} {
		write(name, "new\n")
	}
	git("add", "staged", "mixed", "cancelled", "new-staged", "new-mixed", "new-gone")
	write("mixed", "newer\n")
	write("new-mixed", "newer\n")
	write("cancelled", "old\n")
	git("rm", "-q", "deleted", "recreated")
	write("recreated", "old\n")
	git("mv", "renamed", "moved")
	if err := os.Remove(filepath.Join(dir, "new-gone")); err != nil {
		t.Fatal(err)
	}
	store, err := files.New(dir)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	ctx := context.Background()
	listing, err := List(ctx, store)
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]string{"staged": "staged", "unstaged": "unstaged", "mixed": "mixed", "cancelled": "mixed", "new-staged": "staged", "new-mixed": "mixed", "new-gone": "mixed", "new-untracked": "untracked", "deleted": "staged", "renamed": "staged", "moved": "staged", "recreated": "mixed", "日本語 file": "untracked"}
	if len(listing.Changes) != len(want) {
		t.Fatalf("changes = %+v", listing.Changes)
	}
	var revision string
	wantCodes := map[string][]string{"staged": {"M "}, "unstaged": {" M"}, "mixed": {"MM"}, "cancelled": {"MM"}, "new-staged": {"A "}, "new-mixed": {"AM"}, "new-gone": {"AD"}, "new-untracked": {"??"}, "deleted": {"D "}, "renamed": {"D "}, "moved": {"A "}, "recreated": {"D ", "??"}, "日本語 file": {"??"}}
	for _, change := range listing.Changes {
		if change.Staging != want[change.Path] {
			t.Errorf("change = %+v", change)
		}
		if !slices.Equal(change.GitStatuses, wantCodes[change.Path]) {
			t.Errorf("%s statuses = %q, want %q", change.Path, change.GitStatuses, wantCodes[change.Path])
		}
		if change.Path == "unstaged" {
			revision = change.Revision
		}
		if change.Path == "cancelled" || change.Path == "new-gone" || change.Path == "recreated" {
			if change.Added == nil || change.Deleted == nil || *change.Added != 0 || *change.Deleted != 0 {
				t.Errorf("cancelled counts = %+v", change)
			}
			diff, err := File(ctx, store, change.Path)
			if err != nil || diff.Kind != "text" || diff.Patch != "" {
				t.Errorf("cancelled diff = %+v, %v", diff, err)
			}
		}
	}
	for _, args := range [][]string{{"add", "unstaged"}, {"restore", "--staged", "unstaged"}} {
		git(args...)
		listing, err := List(ctx, store)
		if err != nil {
			t.Fatal(err)
		}
		for _, change := range listing.Changes {
			if change.Path == "unstaged" && (change.Revision != revision || change.Staging != map[string]string{"add": "staged", "restore": "unstaged"}[args[0]]) {
				t.Errorf("staging changed review revision: %+v", change)
			}
		}
	}
	compared, err := ListAt(ctx, store, base)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, change := range compared.Changes {
		if change.Path == "committed" {
			found = true
			if change.Staging != "clean" || change.GitStatuses == nil || len(change.GitStatuses) != 0 {
				t.Errorf("committed = %+v", change)
			}
		}
	}
	if !found {
		t.Fatal("missing committed comparison")
	}
}

func TestUnbornCancelledStaging(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("Git is unavailable")
	}
	dir := t.TempDir()
	if output, err := exec.Command("git", "-C", dir, "init", "-q").CombinedOutput(); err != nil {
		t.Fatalf("git: %v: %s", err, output)
	}
	if err := os.WriteFile(filepath.Join(dir, "gone"), []byte("new\n"), 0600); err != nil {
		t.Fatal(err)
	}
	if output, err := exec.Command("git", "-C", dir, "add", "gone").CombinedOutput(); err != nil {
		t.Fatalf("git: %v: %s", err, output)
	}
	if err := os.Remove(filepath.Join(dir, "gone")); err != nil {
		t.Fatal(err)
	}
	store, err := files.New(dir)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	listing, err := List(context.Background(), store)
	if err != nil || len(listing.Changes) != 1 || listing.Changes[0].Staging != "mixed" || listing.Changes[0].Status != "deleted" {
		t.Fatalf("unborn changes = %+v, %v", listing, err)
	}
	diff, err := File(context.Background(), store, "gone")
	if err != nil || diff.Patch != "" {
		t.Fatalf("unborn diff = %+v, %v", diff, err)
	}
}

func TestConflictedStaging(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("Git is unavailable")
	}
	dir := t.TempDir()
	git := func(args ...string) string {
		t.Helper()
		command := exec.Command("git", append([]string{"-C", dir}, args...)...)
		command.Env = append(os.Environ(), "GIT_CONFIG_NOSYSTEM=1", "GIT_CONFIG_GLOBAL="+os.DevNull)
		output, err := command.CombinedOutput()
		if err != nil {
			t.Fatalf("git %v: %v: %s", args, err, output)
		}
		return strings.TrimSpace(string(output))
	}
	write := func(name, content string) {
		t.Helper()
		if err := os.WriteFile(filepath.Join(dir, name), []byte(content), 0600); err != nil {
			t.Fatal(err)
		}
	}
	git("init", "-q")
	git("config", "user.name", "Test")
	git("config", "user.email", "test@example.com")
	for _, name := range []string{"both", "ours-deleted", "theirs-deleted"} {
		write(name, "base\n")
	}
	git("add", ".")
	git("commit", "-qm", "base")
	git("checkout", "-qb", "ours")
	write("both", "ours\n")
	write("theirs-deleted", "ours\n")
	git("rm", "-q", "ours-deleted")
	git("add", ".")
	git("commit", "-qm", "ours")
	git("checkout", "-qb", "theirs", "HEAD~1")
	write("both", "theirs\n")
	write("ours-deleted", "theirs\n")
	git("rm", "-q", "theirs-deleted")
	git("add", ".")
	git("commit", "-qm", "theirs")
	git("checkout", "-q", "ours")
	if output, err := exec.Command("git", "-C", dir, "merge", "--no-edit", "theirs").CombinedOutput(); err == nil {
		t.Fatalf("expected conflicts: %s", output)
	}
	store, err := files.New(dir)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	listing, err := List(context.Background(), store)
	if err != nil || len(listing.Changes) != 3 {
		t.Fatalf("conflicted listing = %+v, %v", listing, err)
	}
	for _, change := range listing.Changes {
		if change.Staging != "conflicted" {
			t.Errorf("conflict mislabeled: %+v", change)
		}
		want := map[string][]string{"both": {"UU"}, "ours-deleted": {"DU"}, "theirs-deleted": {"UD"}}
		if !slices.Equal(change.GitStatuses, want[change.Path]) {
			t.Errorf("conflict codes = %+v", change)
		}
		if _, err := File(context.Background(), store, change.Path); err != nil {
			t.Errorf("conflicted diff %s: %v", change.Path, err)
		}
	}
}
