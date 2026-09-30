// Package update implements explicitly requested updates from official releases.
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
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"time"
)

const (
	metadataLimit int64 = 2 << 20
	checksumLimit int64 = 1 << 20
	binaryLimit   int64 = 256 << 20
)

var stableVersion = regexp.MustCompile(`^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$`)

// Result describes a check or a completed update. Current is the version before updating.
type Result struct {
	Current, Latest                string
	Comparable, Available, Updated bool
	Path, Backup                   string
}

// Updater is configured for official GitHub releases by New. Its dependencies
// are private so production callers cannot redirect updates to another source.
type Updater struct {
	binaryMax             int64
	version, goos, goarch string
	apiURL, downloadBase  string
	client                *http.Client
	executable            func() (string, error)
	runVersion            func(context.Context, string) (string, error)
	replace               func(string, string) (string, error)
}

// New creates an updater for the current executable and its embedded version.
func New(version string) *Updater {
	return &Updater{
		binaryMax: binaryLimit,
		version:   version, goos: runtime.GOOS, goarch: runtime.GOARCH,
		apiURL:       "https://api.github.com/repos/yomon8/markport/releases/latest",
		downloadBase: "https://github.com/yomon8/markport/releases/download",
		client:       &http.Client{CheckRedirect: secureRedirect},
		executable:   os.Executable, runVersion: executableVersion, replace: replaceExecutable,
	}
}

func secureRedirect(req *http.Request, via []*http.Request) error {
	if req.URL.Scheme != "https" {
		return errors.New("update redirects must use HTTPS")
	}
	if len(via) >= 10 {
		return errors.New("too many update redirects")
	}
	return nil
}

// Check fetches release metadata without downloading binaries or writing files.
func (u *Updater) Check(ctx context.Context) (Result, error) {
	r, _, err := u.latest(ctx, u.version)
	return r, err
}

type release struct {
	Tag        string `json:"tag_name"`
	Draft      bool   `json:"draft"`
	Prerelease bool   `json:"prerelease"`
	Assets     []struct {
		Name string `json:"name"`
	} `json:"assets"`
}

func (u *Updater) latest(ctx context.Context, current string) (Result, string, error) {
	r := Result{Current: current, Comparable: stableVersion.MatchString(current)}
	if (u.goos != "linux" && u.goos != "darwin" && u.goos != "windows") || (u.goarch != "amd64" && u.goarch != "arm64") {
		return r, "", fmt.Errorf("self-update is not supported on %s/%s", u.goos, u.goarch)
	}
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	data, err := u.getBytes(ctx, u.apiURL, metadataLimit)
	if err != nil {
		return r, "", fmt.Errorf("check latest release: %w", err)
	}
	var rel release
	if err := json.Unmarshal(data, &rel); err != nil {
		return r, "", fmt.Errorf("invalid release metadata: %w", err)
	}
	if rel.Draft || rel.Prerelease || !stableVersion.MatchString(rel.Tag) {
		return r, "", errors.New("latest release is not a valid stable version")
	}
	r.Latest = rel.Tag
	asset := fmt.Sprintf("markport_%s_%s_%s", rel.Tag, u.goos, u.goarch)
	if u.goos == "windows" {
		asset += ".exe"
	}
	for _, name := range []string{asset, "checksums_" + rel.Tag + ".txt"} {
		count := 0
		for _, a := range rel.Assets {
			if a.Name == name {
				count++
			}
		}
		if count != 1 {
			return r, "", fmt.Errorf("expected one release asset named %s", name)
		}
	}
	r.Available = r.Comparable && compareVersions(current, rel.Tag) < 0
	return r, asset, nil
}

// compareVersions compares canonical stable versions without integer overflow.
func compareVersions(a, b string) int {
	aa, bb := strings.Split(a[1:], "."), strings.Split(b[1:], ".")
	for i := range aa {
		if len(aa[i]) < len(bb[i]) {
			return -1
		}
		if len(aa[i]) > len(bb[i]) {
			return 1
		}
		if c := strings.Compare(aa[i], bb[i]); c != 0 {
			return c
		}
	}
	return 0
}

// Update verifies a newer stable release and replaces only the running executable.
func (u *Updater) Update(ctx context.Context) (Result, error) {
	r := Result{Current: u.version}
	if !stableVersion.MatchString(u.version) {
		return r, errors.New("development builds cannot self-update; install an official release manually")
	}
	path, err := u.executable()
	if err != nil {
		return r, fmt.Errorf("locate executable: %w", err)
	}
	path, err = filepath.EvalSymlinks(path)
	if err != nil {
		return r, fmt.Errorf("resolve executable: %w", err)
	}
	path, err = filepath.Abs(path)
	if err != nil {
		return r, err
	}
	info, err := os.Stat(path)
	if err != nil {
		return r, err
	}
	if !info.Mode().IsRegular() {
		return r, errors.New("update target is not a regular executable file")
	}
	r.Path = path
	unlock, err := lockTarget(path)
	if err != nil {
		return r, err
	}
	defer unlock()
	// Another updater may have replaced this path before this process acquired
	// the lock. Compare the installed version rather than this process's old one.
	current, err := u.runVersion(ctx, path)
	if err != nil {
		return r, fmt.Errorf("verify installed executable: %w", err)
	}
	if !stableVersion.MatchString(current) {
		return r, errors.New("installed executable is not an official version; install an official release manually")
	}
	r, asset, err := u.latest(ctx, current)
	r.Path = path
	if err != nil || !r.Available {
		return r, err
	}
	stage, err := os.MkdirTemp(filepath.Dir(path), "."+filepath.Base(path)+"-update-")
	if err != nil {
		return r, fmt.Errorf("create update staging directory (check installation permissions): %w", err)
	}
	// Retain recovery files if Windows could not remove or restore the old binary.
	defer func() {
		if r.Backup == "" {
			_ = os.RemoveAll(stage)
		}
	}()
	base := u.downloadBase + "/" + r.Latest + "/"
	downloadCtx, cancel := context.WithTimeout(ctx, 5*time.Minute)
	defer cancel()
	checksums, err := u.getBytes(downloadCtx, base+"checksums_"+r.Latest+".txt", checksumLimit)
	if err != nil {
		return r, fmt.Errorf("download checksums: %w", err)
	}
	expected, err := selectedChecksum(checksums, asset)
	if err != nil {
		return r, err
	}
	staged := filepath.Join(stage, asset)
	if err := u.download(downloadCtx, base+asset, staged, expected, info.Mode().Perm()); err != nil {
		return r, err
	}
	reported, err := u.runVersion(ctx, staged)
	if err != nil {
		return r, fmt.Errorf("verify downloaded executable: %w", err)
	}
	if reported != r.Latest {
		return r, fmt.Errorf("downloaded executable reports %q, expected %s", reported, r.Latest)
	}
	if err := ctx.Err(); err != nil {
		return r, err
	}
	// Do not observe cancellation between Windows's two renames and rollback.
	r.Backup, err = u.replace(staged, path)
	if err != nil {
		return r, fmt.Errorf("replace executable: %w", err)
	}
	r.Updated = true
	return r, nil
}

func (u *Updater) response(ctx context.Context, url string) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "markport/"+u.version)
	if url == u.apiURL {
		req.Header.Set("Accept", "application/vnd.github+json")
	} else {
		req.Header.Set("Accept", "application/octet-stream")
	}
	resp, err := u.client.Do(req)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		resp.Body.Close()
		if resp.StatusCode == 403 || resp.StatusCode == 429 {
			return nil, fmt.Errorf("HTTP %d: GitHub denied the request or its rate limit was reached; try again later", resp.StatusCode)
		}
		return nil, fmt.Errorf("HTTP %d fetching %s", resp.StatusCode, url)
	}
	return resp, nil
}

func (u *Updater) getBytes(ctx context.Context, url string, limit int64) ([]byte, error) {
	resp, err := u.response(ctx, url)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, limit+1))
	if err != nil {
		return nil, err
	}
	if int64(len(data)) > limit {
		return nil, fmt.Errorf("response exceeds %d bytes", limit)
	}
	return data, nil
}

func selectedChecksum(data []byte, asset string) ([]byte, error) {
	var selected []byte
	count := 0
	for _, line := range strings.Split(string(data), "\n") {
		fields := strings.Fields(line)
		if len(fields) < 2 || strings.TrimPrefix(fields[1], "*") != asset {
			continue
		}
		if len(fields) != 2 || len(fields[0]) != 64 {
			return nil, errors.New("invalid checksum entry for " + asset)
		}
		checksum, err := hex.DecodeString(fields[0])
		if err != nil {
			return nil, errors.New("invalid SHA-256 checksum for " + asset)
		}
		selected = checksum
		count++
	}
	if count != 1 {
		return nil, fmt.Errorf("expected one checksum for %s, found %d", asset, count)
	}
	return selected, nil
}

func (u *Updater) download(ctx context.Context, url, path string, expected []byte, mode os.FileMode) error {
	resp, err := u.response(ctx, url)
	if err != nil {
		return fmt.Errorf("download executable: %w", err)
	}
	defer resp.Body.Close()
	f, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	defer f.Close()
	hash := sha256.New()
	n, err := io.Copy(io.MultiWriter(f, hash), io.LimitReader(resp.Body, u.binaryMax+1))
	if err != nil {
		return fmt.Errorf("download executable: %w", err)
	}
	if n > u.binaryMax {
		return errors.New("downloaded executable exceeds 256 MiB")
	}
	if !bytes.Equal(hash.Sum(nil), expected) {
		return errors.New("downloaded executable failed SHA-256 verification")
	}
	if err := f.Chmod(mode); err != nil {
		return err
	}
	if err := f.Sync(); err != nil {
		return err
	}
	return f.Close()
}

type limitedOutput struct{ bytes.Buffer }

func (b *limitedOutput) Write(p []byte) (int, error) {
	if b.Len()+len(p) > 4096 {
		return 0, errors.New("executable version output exceeds 4096 bytes")
	}
	return b.Buffer.Write(p)
}

func executableVersion(ctx context.Context, path string) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, path, "--version")
	var out, stderr limitedOutput
	cmd.Stdout, cmd.Stderr = &out, &stderr
	if err := cmd.Run(); err != nil {
		return "", fmt.Errorf("%w: %s", err, strings.TrimSpace(stderr.String()))
	}
	return strings.TrimSpace(out.String()), nil
}
