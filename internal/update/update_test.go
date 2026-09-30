package update

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func releaseJSON(t *testing.T, tag string) []byte {
	t.Helper()
	asset := fmt.Sprintf("markport_%s_%s_%s", tag, runtime.GOOS, runtime.GOARCH)
	if runtime.GOOS == "windows" {
		asset += ".exe"
	}
	data, err := json.Marshal(map[string]any{"tag_name": tag, "assets": []map[string]string{{"name": asset}, {"name": "checksums_" + tag + ".txt"}}})
	if err != nil {
		t.Fatal(err)
	}
	return data
}

func fixture(t *testing.T, current string) (*Updater, string, *[]byte) {
	t.Helper()
	target := filepath.Join(t.TempDir(), "markport")
	if err := os.WriteFile(target, []byte("old executable"), 0755); err != nil {
		t.Fatal(err)
	}
	// Match the updater's canonical path, including macOS /var aliases and
	// Windows volume-name casing. Temporary directories may have either form.
	var err error
	target, err = filepath.EvalSymlinks(target)
	if err != nil {
		t.Fatal(err)
	}
	binary := []byte("new executable")
	hash := sha256.Sum256(binary)
	metadata := releaseJSON(t, "v1.2.0")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/latest":
			w.Write(metadata)
		case strings.HasSuffix(r.URL.Path, ".txt"):
			asset := fmt.Sprintf("markport_v1.2.0_%s_%s", runtime.GOOS, runtime.GOARCH)
			if runtime.GOOS == "windows" {
				asset += ".exe"
			}
			fmt.Fprintf(w, "%x  %s\n", hash, asset)
		default:
			w.Write(binary)
		}
	}))
	t.Cleanup(server.Close)
	u := New(current)
	u.apiURL, u.downloadBase = server.URL+"/latest", server.URL+"/download"
	u.executable = func() (string, error) { return target, nil }
	u.runVersion = func(_ context.Context, path string) (string, error) {
		if path == target {
			return current, nil
		}
		return "v1.2.0", nil
	}
	return u, target, &metadata
}

func TestCheckVersions(t *testing.T) {
	for _, tc := range []struct {
		current               string
		comparable, available bool
	}{
		{"v1.1.9", true, true}, {"v1.2.0", true, false}, {"v1.10.0", true, false},
		{"v2.0.0", true, false}, {"dev", false, false}, {"ci", false, false},
		{"v1.02.0", false, false}, {"v1.2.0-rc.1", false, false},
	} {
		t.Run(tc.current, func(t *testing.T) {
			u, target, _ := fixture(t, tc.current)
			r, err := u.Check(context.Background())
			if err != nil || r.Current != tc.current || r.Latest != "v1.2.0" || r.Comparable != tc.comparable || r.Available != tc.available {
				t.Fatalf("%+v, %v", r, err)
			}
			entries, err := os.ReadDir(filepath.Dir(target))
			if err != nil || len(entries) != 1 {
				t.Fatalf("check wrote installation files: %v, %v", entries, err)
			}
		})
	}
	if compareVersions("v999999999999999999999.0.0", "v1000000000000000000000.0.0") >= 0 {
		t.Fatal("comparison overflow")
	}
}

func TestInvalidRelease(t *testing.T) {
	for _, tc := range []struct {
		name   string
		mutate func(map[string]any)
	}{
		{"draft", func(r map[string]any) { r["draft"] = true }},
		{"prerelease", func(r map[string]any) { r["prerelease"] = true }},
		{"invalid tag", func(r map[string]any) { r["tag_name"] = "../../bad" }},
		{"missing assets", func(r map[string]any) { r["assets"] = []any{} }},
		{"duplicate assets", func(r map[string]any) { a := r["assets"].([]any); r["assets"] = append(a, a[0]) }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			u, _, metadata := fixture(t, "v1.0.0")
			var rel map[string]any
			if err := json.Unmarshal(*metadata, &rel); err != nil {
				t.Fatal(err)
			}
			tc.mutate(rel)
			data, err := json.Marshal(rel)
			if err != nil {
				t.Fatal(err)
			}
			*metadata = data
			if _, err := u.Check(context.Background()); err == nil {
				t.Fatal("accepted invalid release")
			}
		})
	}
}

func TestUpdateSuccess(t *testing.T) {
	u, target, _ := fixture(t, "v1.0.0")
	r, err := u.Update(context.Background())
	if err != nil || !r.Updated || r.Current != "v1.0.0" || r.Path != target {
		t.Fatalf("%+v, %v", r, err)
	}
	data, err := os.ReadFile(target)
	if err != nil || string(data) != "new executable" {
		t.Fatalf("%s, %v", data, err)
	}
	info, err := os.Stat(target)
	if err != nil {
		t.Fatal(err)
	}
	if runtime.GOOS != "windows" && info.Mode().Perm() != 0755 {
		t.Fatalf("mode %v", info.Mode())
	}
	entries, err := filepath.Glob(filepath.Join(filepath.Dir(target), ".markport-update-*"))
	if err != nil || len(entries) != 0 {
		t.Fatalf("staging files remain: %v, %v", entries, err)
	}
}

func TestUpdateNoDowngradeAndRecheck(t *testing.T) {
	for _, current := range []string{"v1.2.0", "v1.10.0"} {
		u, target, _ := fixture(t, "v1.0.0")
		u.runVersion = func(context.Context, string) (string, error) { return current, nil }
		r, err := u.Update(context.Background())
		if err != nil || r.Updated || r.Current != current {
			t.Fatalf("%+v, %v", r, err)
		}
		assertOld(t, target)
	}
}

func assertOld(t *testing.T, target string) {
	t.Helper()
	data, err := os.ReadFile(target)
	if err != nil || string(data) != "old executable" {
		t.Fatalf("old executable changed: %q, %v", data, err)
	}
	entries, err := filepath.Glob(filepath.Join(filepath.Dir(target), ".markport-update-*"))
	if err != nil || len(entries) != 0 {
		t.Fatalf("staging files remain: %v, %v", entries, err)
	}
}

type transportFunc func(*http.Request) (*http.Response, error)

func (f transportFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestUpdateFailuresPreserveInstalled(t *testing.T) {
	for _, name := range []string{"checksum", "version", "run version", "size", "replace", "cancel", "missing checksum", "duplicate checksum", "malformed checksum", "binary 404", "truncated download", "metadata", "permissions", "development"} {
		t.Run(name, func(t *testing.T) {
			u, target, metadata := fixture(t, "v1.0.0")
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			switch name {
			case "checksum":
				u.client = &http.Client{Transport: transportFunc(func(req *http.Request) (*http.Response, error) {
					resp, err := http.DefaultTransport.RoundTrip(req)
					if err == nil && strings.HasSuffix(req.URL.Path, ".txt") {
						data, _ := io.ReadAll(resp.Body)
						resp.Body.Close()
						data[0] = 'f'
						data[1] = 'f'
						resp.Body = io.NopCloser(bytes.NewReader(data))
					}
					return resp, err
				})}
			case "version":
				u.runVersion = func(_ context.Context, path string) (string, error) {
					if path == target {
						return "v1.0.0", nil
					}
					return "v1.1.0", nil
				}
			case "run version":
				u.runVersion = func(context.Context, string) (string, error) { return "", errors.New("cannot execute") }
			case "size":
				u.binaryMax = 4
			case "replace":
				u.replace = func(string, string) (string, error) { return "", errors.New("rename failed") }
			case "cancel":
				old := u.runVersion
				u.runVersion = func(ctx context.Context, path string) (string, error) {
					v, err := old(ctx, path)
					if path != target {
						cancel()
					}
					return v, err
				}
			case "missing checksum", "duplicate checksum", "malformed checksum", "binary 404", "truncated download":
				u.client = &http.Client{Transport: transportFunc(func(req *http.Request) (*http.Response, error) {
					resp, err := http.DefaultTransport.RoundTrip(req)
					if err != nil {
						return nil, err
					}
					if strings.HasSuffix(req.URL.Path, ".txt") {
						data, _ := io.ReadAll(resp.Body)
						resp.Body.Close()
						switch name {
						case "missing checksum":
							data = nil
						case "duplicate checksum":
							data = append(data, data...)
						case "malformed checksum":
							data[0] = 'z'
						}
						resp.Body = io.NopCloser(bytes.NewReader(data))
					} else if req.URL.Path != "/latest" {
						if name == "binary 404" {
							resp.StatusCode = 404
						}
						if name == "truncated download" {
							resp.Body.Close()
							resp.Body = io.NopCloser(&failingReader{})
						}
					}
					return resp, nil
				})}
			case "metadata":
				*metadata = []byte("not json")
			case "permissions":
				// A file in place of the staging directory's parent deterministically
				// prevents installation access, including privileged test environments.
				u.executable = func() (string, error) { return filepath.Join(target, "markport"), nil }
			case "development":
				u.version = "dev"
				u.executable = func() (string, error) { t.Fatal("development update accessed executable"); return "", nil }
			}
			if r, err := u.Update(ctx); err == nil || r.Updated {
				t.Fatalf("failure accepted: %+v, %v", r, err)
			}
			assertOld(t, target)
		})
	}
}

type failingReader struct{}

func (*failingReader) Read([]byte) (int, error) { return 0, io.ErrUnexpectedEOF }

func TestResponseBoundsAndErrors(t *testing.T) {
	for _, status := range []int{403, 404, 429, 500} {
		t.Run(fmt.Sprint(status), func(t *testing.T) {
			u := New("v1.0.0")
			u.client.Transport = transportFunc(func(*http.Request) (*http.Response, error) {
				return &http.Response{StatusCode: status, Body: io.NopCloser(strings.NewReader("error"))}, nil
			})
			if _, err := u.Check(context.Background()); err == nil {
				t.Fatal("accepted HTTP error")
			}
		})
	}
	u := New("v1.0.0")
	u.client.Transport = transportFunc(func(*http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader("12345"))}, nil
	})
	if _, err := u.getBytes(context.Background(), u.apiURL, 4); err == nil {
		t.Fatal("accepted oversized response")
	}
	u.client.Transport = transportFunc(func(r *http.Request) (*http.Response, error) { <-r.Context().Done(); return nil, r.Context().Err() })
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Millisecond)
	defer cancel()
	if _, err := u.Check(ctx); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("timeout: %v", err)
	}
	req, _ := http.NewRequest("GET", "http://example.com", nil)
	if err := secureRedirect(req, nil); err == nil {
		t.Fatal("accepted HTTPS downgrade")
	}
}

func TestInstallationLock(t *testing.T) {
	target := filepath.Join(t.TempDir(), "markport")
	unlock, err := lockTarget(target)
	if err != nil {
		t.Fatal(err)
	}
	defer unlock()
	if second, err := lockTarget(target); err == nil {
		second()
		t.Fatal("concurrent lock acquired")
	}
}

func TestSymlinkTarget(t *testing.T) {
	u, target, _ := fixture(t, "v1.0.0")
	link := filepath.Join(filepath.Dir(target), "alias")
	if err := os.Symlink(target, link); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}
	u.executable = func() (string, error) { return link, nil }
	r, err := u.Update(context.Background())
	if err != nil || !r.Updated || r.Path != target {
		t.Fatalf("%+v, %v", r, err)
	}
	info, err := os.Lstat(link)
	if err != nil || info.Mode()&os.ModeSymlink == 0 {
		t.Fatalf("symlink replaced: %v, %v", info, err)
	}
}

// Separate native test executables act as old and new self-updating processes.
// This hook exists only in tests, never in distributed Markport.
var testHelperVersion = "dev"

func init() {
	if os.Getenv("MARKPORT_UPDATE_TEST_HELPER") != "1" {
		return
	}
	version := testHelperVersion
	if len(os.Args) == 2 && os.Args[1] == "--version" {
		fmt.Println(version)
		os.Exit(0)
	}
	if len(os.Args) == 2 && os.Args[1] == "--update" {
		u := New(version)
		u.apiURL = os.Getenv("MARKPORT_UPDATE_TEST_URL") + "/latest"
		u.downloadBase = os.Getenv("MARKPORT_UPDATE_TEST_URL") + "/download"
		r, err := u.Update(context.Background())
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		if err := json.NewEncoder(os.Stdout).Encode(r); err != nil {
			panic(err)
		}
		os.Exit(0)
	}
	panic("unexpected helper arguments")
}

func TestRunningExecutableSelfUpdate(t *testing.T) {
	dir := t.TempDir()
	target := filepath.Join(dir, "markport")
	staged := filepath.Join(dir, "new-markport")
	if runtime.GOOS == "windows" {
		target += ".exe"
		staged += ".exe"
	}
	for _, build := range []struct{ path, version string }{{target, "v1.0.0"}, {staged, "v1.2.0"}} {
		ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
		cmd := exec.CommandContext(ctx, "go", "test", "-c", "-o", build.path, "-ldflags", "-X github.com/markport/markport/internal/update.testHelperVersion="+build.version, ".")
		output, err := cmd.CombinedOutput()
		cancel()
		if err != nil {
			t.Fatalf("build native helper: %v\n%s", err, output)
		}
	}
	// Build complete native executables rather than modifying binaries, so the
	// toolchain's platform-specific signing and executable format stay intact.
	newBinary, err := os.ReadFile(staged)
	if err != nil {
		t.Fatal(err)
	}
	hash := sha256.Sum256(newBinary)
	metadata := releaseJSON(t, "v1.2.0")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/latest":
			w.Write(metadata)
		case strings.HasSuffix(r.URL.Path, ".txt"):
			var rel release
			if err := json.Unmarshal(metadata, &rel); err != nil {
				t.Error(err)
				return
			}
			fmt.Fprintf(w, "%s  %s\n", hex.EncodeToString(hash[:]), rel.Assets[0].Name)
		default:
			w.Write(newBinary)
		}
	}))
	defer server.Close()
	cmd := exec.Command(target, "--update")
	cmd.Env = append(os.Environ(), "MARKPORT_UPDATE_TEST_HELPER=1", "MARKPORT_UPDATE_TEST_URL="+server.URL)
	output, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("self-update: %v\n%s", err, output)
	}
	var result Result
	if err := json.Unmarshal(output, &result); err != nil || !result.Updated {
		t.Fatalf("result: %s, %v", output, err)
	}
	cmd = exec.Command(target, "--version")
	cmd.Env = append(os.Environ(), "MARKPORT_UPDATE_TEST_HELPER=1")
	output, err = cmd.CombinedOutput()
	if err != nil || strings.TrimSpace(string(output)) != "v1.2.0" {
		t.Fatalf("new executable: %s, %v", output, err)
	}
	if result.Backup != "" {
		if err := os.Remove(result.Backup); err != nil {
			t.Fatalf("old process exited but backup cannot be removed: %v", err)
		}
	}
}

func TestWindowsRollback(t *testing.T) {
	for _, failRollback := range []bool{false, true} {
		t.Run(fmt.Sprint(failRollback), func(t *testing.T) {
			dir := t.TempDir()
			target, staged := filepath.Join(dir, "markport.exe"), filepath.Join(dir, "new.exe")
			if err := os.WriteFile(target, []byte("old executable"), 0755); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(staged, []byte("new executable"), 0755); err != nil {
				t.Fatal(err)
			}
			calls := 0
			rename := func(a, b string) error {
				calls++
				if calls == 2 || (calls == 3 && failRollback) {
					return errors.New("injected failure")
				}
				return os.Rename(a, b)
			}
			backup, err := replaceWindows(staged, target, rename, os.Remove)
			if err == nil {
				t.Fatal("expected installation failure")
			}
			if failRollback {
				if backup == "" || !strings.Contains(err.Error(), "recover manually") {
					t.Fatalf("%s, %v", backup, err)
				}
				data, err := os.ReadFile(backup)
				if err != nil || string(data) != "old executable" {
					t.Fatalf("backup lost: %q, %v", data, err)
				}
			} else {
				if backup != "" {
					t.Fatal("unexpected backup")
				}
				data, err := os.ReadFile(target)
				if err != nil || string(data) != "old executable" {
					t.Fatalf("rollback: %q, %v", data, err)
				}
			}
		})
	}
}

func TestUpdateReadOnlyInstallation(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Windows installation permissions are governed by ACLs")
	}
	u, target, _ := fixture(t, "v1.0.0")
	dir := filepath.Dir(target)
	if err := os.Chmod(dir, 0555); err != nil {
		t.Fatal(err)
	}
	defer func() { _ = os.Chmod(dir, 0755) }()
	if f, err := os.Create(filepath.Join(dir, "permission-probe")); err == nil {
		f.Close()
		os.Remove(filepath.Join(dir, "permission-probe"))
		t.Skip("test process can bypass directory permissions")
	}
	if _, err := u.Update(context.Background()); err == nil || !strings.Contains(err.Error(), "permissions") {
		t.Fatalf("read-only installation: %v", err)
	}
	assertOld(t, target)
}

func TestRecoveryBackupRetained(t *testing.T) {
	u, target, _ := fixture(t, "v1.0.0")
	u.replace = func(staged, target string) (string, error) {
		return replaceWindows(staged, target, func(a, b string) error {
			if a == staged || strings.HasSuffix(a, "previous.exe") {
				return errors.New("rename denied")
			}
			return os.Rename(a, b)
		}, os.Remove)
	}
	r, err := u.Update(context.Background())
	if err == nil || r.Backup == "" {
		t.Fatalf("%+v, %v", r, err)
	}
	data, err := os.ReadFile(r.Backup)
	if err != nil || string(data) != "old executable" {
		t.Fatalf("recovery backup deleted: %q, %v", data, err)
	}
	if _, err := os.Stat(target); !os.IsNotExist(err) {
		t.Fatalf("expected missing target after failed rollback: %v", err)
	}
}

func TestLockedUpdateDoesNotDownload(t *testing.T) {
	u, target, _ := fixture(t, "v1.0.0")
	unlock, err := lockTarget(target)
	if err != nil {
		t.Fatal(err)
	}
	defer unlock()
	u.client.Transport = transportFunc(func(*http.Request) (*http.Response, error) {
		t.Fatal("concurrent update reached network")
		return nil, nil
	})
	if _, err := u.Update(context.Background()); err == nil {
		t.Fatal("accepted concurrent update")
	}
	assertOld(t, target)
}

func TestChecksumFormats(t *testing.T) {
	hash := strings.Repeat("a", 64)
	for _, separator := range []string{"  ", " *"} {
		data := []byte(strings.Repeat("b", 64) + "  unrelated\n" + hash + separator + "markport\r\n")
		got, err := selectedChecksum(data, "markport")
		if err != nil || hex.EncodeToString(got) != hash {
			t.Fatalf("%x, %v", got, err)
		}
	}
}

func TestWindowsPreviousExecutableInUse(t *testing.T) {
	u, target, _ := fixture(t, "v1.0.0")
	u.replace = func(staged, target string) (string, error) {
		return replaceWindows(staged, target, os.Rename, func(string) error { return errors.New("old executable is still running") })
	}
	r, err := u.Update(context.Background())
	if err != nil || !r.Updated || r.Backup == "" {
		t.Fatalf("%+v, %v", r, err)
	}
	data, err := os.ReadFile(r.Backup)
	if err != nil || string(data) != "old executable" {
		t.Fatalf("previous executable lost: %q, %v", data, err)
	}
	data, err = os.ReadFile(target)
	if err != nil || string(data) != "new executable" {
		t.Fatalf("new executable: %q, %v", data, err)
	}
}

func TestUpdateWithAliasedTempDirectory(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Windows normalizes volume names rather than TMPDIR")
	}
	root := t.TempDir()
	alias := filepath.Join(root, "alias")
	if err := os.Symlink(root, alias); err != nil {
		t.Fatal(err)
	}
	t.Setenv("TMPDIR", alias)
	t.Run("update", func(t *testing.T) {
		u, target, _ := fixture(t, "v1.0.0")
		r, err := u.Update(context.Background())
		if err != nil || !r.Updated || r.Path != target {
			t.Fatalf("aliased installation: %+v, %v", r, err)
		}
	})
}
