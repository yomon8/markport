package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/markport/markport/internal/files"
	"github.com/markport/markport/internal/gitdiff"
)

func gitCommand(t *testing.T, dir string, args ...string) {
	t.Helper()
	cmd := exec.Command("git", append([]string{"-C", dir}, args...)...)
	cmd.Env = append(os.Environ(), "GIT_CONFIG_NOSYSTEM=1", "GIT_CONFIG_GLOBAL="+os.DevNull)
	if output, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("git %v: %v: %s", args, err, output)
	}
}

func gitServer(t *testing.T, dir string) *Server {
	t.Helper()
	store, err := files.New(dir)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	app, err := New(store, "127.0.0.1", 3000)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(app.Close)
	return app
}

func TestGitChangesAndDiff(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("Git is unavailable")
	}
	dir := t.TempDir()
	gitCommand(t, dir, "init", "-q")
	gitCommand(t, dir, "config", "user.email", "test@example.com")
	gitCommand(t, dir, "config", "user.name", "Test")
	if err := os.Mkdir(filepath.Join(dir, "docs"), 0755); err != nil {
		t.Fatal(err)
	}
	for name, content := range map[string]string{"staged.md": "old\n", "unstaged.md": "old\n", "deleted.md": "old\n", "docs/nested.md": "old\n", ".gitignore": "ignored.md\n"} {
		if err := os.WriteFile(filepath.Join(dir, filepath.FromSlash(name)), []byte(content), 0644); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(dir, "renamed.md"), []byte("rename me\n"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "binary.bin"), []byte{0, 1, 2}, 0644); err != nil {
		t.Fatal(err)
	}
	gitCommand(t, dir, "add", ".")
	gitCommand(t, dir, "commit", "-qm", "initial")
	for name, content := range map[string]string{"staged.md": "new staged\n", "unstaged.md": "new unstaged\n", "docs/nested.md": "new nested\n", "new.md": "<script>alert(1)</script>\n", "ignored.md": "ignored\n"} {
		if err := os.WriteFile(filepath.Join(dir, filepath.FromSlash(name)), []byte(content), 0644); err != nil {
			t.Fatal(err)
		}
	}
	gitCommand(t, dir, "add", "staged.md")
	if err := os.Rename(filepath.Join(dir, "renamed.md"), filepath.Join(dir, "moved.md")); err != nil {
		t.Fatal(err)
	}
	gitCommand(t, dir, "add", "-A", "renamed.md", "moved.md")
	if err := os.WriteFile(filepath.Join(dir, "binary.bin"), []byte{0, 1, 3}, 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(filepath.Join(dir, "deleted.md")); err != nil {
		t.Fatal(err)
	}
	app := gitServer(t, dir)
	r := request(app, "localhost:3000", "/api/git/changes")
	if r.Code != 200 {
		t.Fatalf("changes: %d %s", r.Code, r.Body.String())
	}
	var listing gitdiff.Listing
	if err := json.Unmarshal(r.Body.Bytes(), &listing); err != nil {
		t.Fatal(err)
	}
	want := map[string]string{"staged.md": "modified", "unstaged.md": "modified", "deleted.md": "deleted", "docs/nested.md": "modified", "new.md": "added", "renamed.md": "deleted", "moved.md": "added", "binary.bin": "modified"}
	if !listing.Available || len(listing.Changes) != len(want) {
		t.Fatalf("changes: %+v", listing)
	}
	if listing.RootID == "" {
		t.Fatal("changes missing root identity")
	}
	revisions := make(map[string]string)
	for _, change := range listing.Changes {
		if want[change.Path] != change.Status {
			t.Errorf("change: %+v", change)
		}
		if change.Revision == "" {
			t.Errorf("change missing revision: %+v", change)
		}
		revisions[change.Path] = change.Revision
	}
	unchanged := request(app, "localhost:3000", "/api/git/changes")
	var unchangedListing gitdiff.Listing
	if unchanged.Code != 200 || json.Unmarshal(unchanged.Body.Bytes(), &unchangedListing) != nil {
		t.Fatalf("unchanged changes: %d %s", unchanged.Code, unchanged.Body.String())
	}
	for _, change := range unchangedListing.Changes {
		if change.Revision != revisions[change.Path] {
			t.Errorf("revision changed without content change: %s", change.Path)
		}
	}
	if err := os.WriteFile(filepath.Join(dir, "unstaged.md"), []byte("another edit\n"), 0644); err != nil {
		t.Fatal(err)
	}
	updated := request(app, "localhost:3000", "/api/git/changes")
	var updatedListing gitdiff.Listing
	if updated.Code != 200 || json.Unmarshal(updated.Body.Bytes(), &updatedListing) != nil {
		t.Fatalf("updated changes: %d %s", updated.Code, updated.Body.String())
	}
	for _, change := range updatedListing.Changes {
		if (change.Revision != revisions[change.Path]) != (change.Path == "unstaged.md") {
			t.Errorf("unexpected revision change: %s", change.Path)
		}
	}
	if err := os.WriteFile(filepath.Join(dir, "unstaged.md"), []byte("new unstaged\n"), 0644); err != nil {
		t.Fatal(err)
	}
	for path, needle := range map[string]string{"staged.md": "+new staged", "unstaged.md": "+new unstaged", "deleted.md": "-old", "new.md": "+<script>alert(1)</script>"} {
		result := request(app, "localhost:3000", "/api/git/diff?path="+path)
		var diff gitdiff.Diff
		if result.Code != 200 || json.Unmarshal(result.Body.Bytes(), &diff) != nil || !strings.Contains(diff.Patch, needle) {
			t.Errorf("diff %s: %d %s", path, result.Code, result.Body.String())
		}
	}
	var binary gitdiff.Diff
	binaryResult := request(app, "localhost:3000", "/api/git/diff?path=binary.bin")
	if binaryResult.Code != 200 || json.Unmarshal(binaryResult.Body.Bytes(), &binary) != nil || binary.Kind != "binary" {
		t.Fatalf("binary diff: %d %s", binaryResult.Code, binaryResult.Body.String())
	}
	if tag := r.Header().Get("ETag"); tag == "" {
		t.Fatal("changes missing ETag")
	} else {
		req := httptest.NewRequest("GET", "/api/git/changes", nil)
		req.Host = "localhost:3000"
		req.Header.Set("If-None-Match", tag)
		result := httptest.NewRecorder()
		app.ServeHTTP(result, req)
		if result.Code != http.StatusNotModified {
			t.Fatalf("unchanged status: %d", result.Code)
		}
	}
	for _, url := range []string{"/api/git/diff?path=../staged.md", "/api/git/diff?path=.git/config"} {
		if result := request(app, "localhost:3000", url); result.Code != 400 {
			t.Errorf("unsafe %s: %d", url, result.Code)
		}
	}
	if result := request(app, "localhost:3000", "/api/git/diff?path=.gitignore"); result.Code != 404 {
		t.Errorf("unchanged: %d", result.Code)
	}
	child := gitServer(t, filepath.Join(dir, "docs"))
	result := request(child, "localhost:3000", "/api/git/changes")
	var childListing gitdiff.Listing
	if result.Code != 200 || json.Unmarshal(result.Body.Bytes(), &childListing) != nil || len(childListing.Changes) != 1 || childListing.Changes[0].Path != "nested.md" {
		t.Fatalf("subdirectory changes: %d %s", result.Code, result.Body.String())
	}
	if childListing.RootID == listing.RootID {
		t.Fatal("subdirectory shared review identity with repository root")
	}
	if result := request(child, "localhost:3000", "/api/git/diff?path=nested.md"); result.Code != 200 || !strings.Contains(result.Body.String(), "new nested") {
		t.Fatalf("subdirectory diff: %d %s", result.Code, result.Body.String())
	}
}

func TestGitUnavailable(t *testing.T) {
	app := gitServer(t, t.TempDir())
	result := request(app, "localhost:3000", "/api/git/changes")
	var listing gitdiff.Listing
	if result.Code != 200 || json.Unmarshal(result.Body.Bytes(), &listing) != nil || listing.Available || listing.Reason != "not_repository" {
		t.Fatalf("no repository: %d %s", result.Code, result.Body.String())
	}
	if result := request(app, "localhost:3000", "/api/git/diff?path=a.md"); result.Code != 503 {
		t.Fatalf("no repository diff: %d", result.Code)
	}
}

func TestGitUnbornAndSymlink(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("Git is unavailable")
	}
	dir := t.TempDir()
	gitCommand(t, dir, "init", "-q")
	if err := os.WriteFile(filepath.Join(dir, "staged.md"), []byte("first\n"), 0644); err != nil {
		t.Fatal(err)
	}
	gitCommand(t, dir, "add", "staged.md")
	if err := os.WriteFile(filepath.Join(dir, "untracked.md"), []byte("second\n"), 0644); err != nil {
		t.Fatal(err)
	}
	outside := filepath.Join(t.TempDir(), "outside.md")
	if err := os.WriteFile(outside, []byte("secret\n"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(dir, "link.md")); err != nil {
		t.Logf("symlink unavailable: %v", err)
	}
	app := gitServer(t, dir)
	result := request(app, "localhost:3000", "/api/git/changes")
	var listing gitdiff.Listing
	if result.Code != 200 || json.Unmarshal(result.Body.Bytes(), &listing) != nil || len(listing.Changes) != 2 {
		t.Fatalf("unborn changes: %d %s", result.Code, result.Body.String())
	}
	for _, change := range listing.Changes {
		if change.Status != "added" || change.Path == "link.md" {
			t.Errorf("unexpected change: %+v", change)
		}
		if result := request(app, "localhost:3000", "/api/git/diff?path="+change.Path); result.Code != 200 || !strings.Contains(result.Body.String(), "@@ -0,0 +1,1 @@") {
			t.Errorf("unborn diff %s: %d %s", change.Path, result.Code, result.Body.String())
		}
	}
	if result := request(app, "localhost:3000", "/api/git/diff?path=link.md"); result.Code != 404 {
		t.Errorf("symlink diff: %d", result.Code)
	}
}
