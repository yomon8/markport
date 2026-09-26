package gitdiff

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/markport/markport/internal/files"
)

const maxOutput = 10 << 20

var (
	ErrUnavailable = errors.New("Git is unavailable")
	ErrNoChange    = errors.New("file has no changes")
	ErrTooLarge    = errors.New("Git output exceeds 10 MiB")
)

type Change struct {
	Path     string `json:"path"`
	Status   string `json:"status"`
	Revision string `json:"revision"`
	Added    *int   `json:"added"`
	Deleted  *int   `json:"deleted"`
}

type lineCounts struct{ added, deleted *int }

var statsCache = struct {
	sync.Mutex
	values map[string]lineCounts
}{values: make(map[string]lineCounts)}

type Listing struct {
	Available bool     `json:"available"`
	Reason    string   `json:"reason,omitempty"`
	RootID    string   `json:"rootId,omitempty"`
	Changes   []Change `json:"changes"`
}

type Diff struct {
	Path  string `json:"path"`
	Kind  string `json:"kind"`
	Patch string `json:"patch"`
}

type repository struct {
	root   string
	prefix string
	unborn bool
	head   string
}

type limitedBuffer struct {
	bytes.Buffer
	overflow bool
}

func (b *limitedBuffer) Write(p []byte) (int, error) {
	if b.Len()+len(p) > maxOutput {
		b.overflow = true
		return 0, ErrTooLarge
	}
	return b.Buffer.Write(p)
}

func run(ctx context.Context, dir string, args ...string) ([]byte, error) {
	return runCommand(ctx, dir, false, args...)
}

func runCommand(ctx context.Context, dir string, allowDiffExit bool, args ...string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	arguments := append([]string{"--no-pager", "--literal-pathspecs", "-C", dir}, args...)
	cmd := exec.CommandContext(ctx, "git", arguments...)
	cmd.Env = make([]string, 0, len(os.Environ())+1)
	for _, value := range os.Environ() {
		if !strings.HasPrefix(strings.ToUpper(value), "GIT_") {
			cmd.Env = append(cmd.Env, value)
		}
	}
	cmd.Env = append(cmd.Env, "GIT_OPTIONAL_LOCKS=0", "GIT_TERMINAL_PROMPT=0")
	var output limitedBuffer
	var stderr limitedBuffer
	cmd.Stdout, cmd.Stderr = &output, &stderr
	err := cmd.Run()
	if ctx.Err() != nil {
		return nil, ctx.Err()
	}
	if output.overflow || stderr.overflow {
		return nil, ErrTooLarge
	}
	var exit *exec.ExitError
	if allowDiffExit && errors.As(err, &exit) && exit.ExitCode() == 1 {
		return output.Bytes(), nil
	}
	if err != nil {
		return nil, fmt.Errorf("git %s: %w", args[0], err)
	}
	return output.Bytes(), nil
}

func discover(ctx context.Context, store *files.Store) (repository, string, error) {
	if _, err := exec.LookPath("git"); err != nil {
		return repository{}, "git_unavailable", nil
	}
	output, err := run(ctx, store.Path, "rev-parse", "--show-toplevel")
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled) || errors.Is(err, ErrTooLarge) {
			return repository{}, "", err
		}
		return repository{}, "not_repository", nil
	}
	root, err := filepath.EvalSymlinks(strings.TrimSpace(string(output)))
	if err != nil {
		return repository{}, "not_repository", nil
	}
	rel, err := filepath.Rel(root, store.Path)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return repository{}, "not_repository", nil
	}
	prefix := ""
	if rel != "." {
		prefix = filepath.ToSlash(rel) + "/"
	}
	head, err := run(ctx, root, "rev-parse", "--verify", "HEAD")
	if errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled) || errors.Is(err, ErrTooLarge) {
		return repository{}, "", err
	}
	return repository{root: root, prefix: prefix, unborn: err != nil, head: strings.TrimSpace(string(head))}, "", nil
}

func (repo repository) path(name string) string { return repo.prefix + name }
func (repo repository) scope() string {
	if repo.prefix == "" {
		return "."
	}
	return repo.prefix
}

func visible(store *files.Store, name string, deleted bool) bool {
	if _, err := files.Parts(name); err != nil {
		return false
	}
	f, err := store.Open(name)
	if err == nil {
		_ = f.Close()
		return true
	}
	return deleted && errors.Is(err, fs.ErrNotExist)
}

func names(output []byte, withStatus bool) ([]Change, error) {
	fields := bytes.Split(output, []byte{0})
	changes := make([]Change, 0, len(fields)/2)
	if len(fields) == 0 || len(fields[len(fields)-1]) != 0 {
		return nil, fmt.Errorf("malformed Git response")
	}
	fields = fields[:len(fields)-1]
	step := 1
	if withStatus {
		step = 2
	}
	if len(fields)%step != 0 {
		return nil, fmt.Errorf("malformed Git response")
	}
	for i := 0; i < len(fields); i += step {
		status := "added"
		if withStatus {
			switch string(fields[i]) {
			case "A":
				status = "added"
			case "D":
				status = "deleted"
			case "M", "T", "U":
				status = "modified"
			default:
				return nil, fmt.Errorf("unexpected Git status")
			}
		}
		name := string(fields[i+step-1])
		if name == "" {
			return nil, fmt.Errorf("malformed Git response")
		}
		changes = append(changes, Change{Path: name, Status: status})
	}
	return changes, nil
}

func collect(ctx context.Context, store *files.Store, repo repository, withStats bool) ([]Change, error) {
	var tracked []Change
	if repo.unborn {
		output, err := run(ctx, repo.root, "ls-files", "--cached", "-z", "--", repo.scope())
		if err != nil {
			return nil, err
		}
		tracked, err = names(output, false)
		if err != nil {
			return nil, err
		}
	} else {
		output, err := run(ctx, repo.root, "diff", "--name-status", "-z", "--no-renames", "--no-ext-diff", "--no-textconv", repo.head, "--", repo.scope())
		if err != nil {
			return nil, err
		}
		tracked, err = names(output, true)
		if err != nil {
			return nil, err
		}
	}
	output, err := run(ctx, repo.root, "ls-files", "--others", "--exclude-standard", "-z", "--", repo.scope())
	if err != nil {
		return nil, err
	}
	untracked, err := names(output, false)
	if err != nil {
		return nil, err
	}
	all := append(tracked, untracked...)
	unique := make(map[string]Change, len(all))
	for _, change := range all {
		if !strings.HasPrefix(change.Path, repo.prefix) {
			continue
		}
		change.Path = strings.TrimPrefix(change.Path, repo.prefix)
		if visible(store, change.Path, change.Status == "deleted") {
			if previous, ok := unique[change.Path]; ok && previous.Status == "deleted" && change.Status == "added" {
				change.Status = "modified"
			}
			unique[change.Path] = change
		}
	}
	result := make([]Change, 0, len(unique))
	for _, change := range unique {
		if err := fingerprint(ctx, store, repo, &change); err != nil {
			return nil, err
		}
		if withStats {
			counts := countChange(ctx, store, repo, change)
			change.Added, change.Deleted = counts.added, counts.deleted
		}
		result = append(result, change)
	}
	sort.Slice(result, func(i, j int) bool { return result[i].Path < result[j].Path })
	return result, nil
}

func fingerprint(ctx context.Context, store *files.Store, repo repository, change *Change) error {
	hash := sha256.New()
	_, _ = io.WriteString(hash, change.Status+"\x00")
	if change.Status != "added" {
		// A review is tied to this file's HEAD blob, not the HEAD commit.
		blob, err := run(ctx, repo.root, "rev-parse", repo.head+":"+repo.path(change.Path))
		if err != nil {
			return err
		}
		_, _ = hash.Write(blob)
	}
	if change.Status != "deleted" {
		file, err := store.Open(change.Path)
		if err != nil {
			return err
		}
		_, copyErr := io.Copy(hash, file)
		closeErr := file.Close()
		if copyErr != nil {
			return copyErr
		}
		if closeErr != nil {
			return closeErr
		}
	}
	change.Revision = hex.EncodeToString(hash.Sum(nil))
	return ctx.Err()
}

func List(ctx context.Context, store *files.Store) (Listing, error) {
	repo, reason, err := discover(ctx, store)
	if err != nil {
		return Listing{}, err
	}
	if reason != "" {
		return Listing{Available: false, Reason: reason, Changes: []Change{}}, nil
	}
	changes, err := collect(ctx, store, repo, true)
	rootID := sha256.Sum256([]byte(store.Path))
	return Listing{Available: true, RootID: hex.EncodeToString(rootID[:]), Changes: changes}, err
}

func File(ctx context.Context, store *files.Store, name string) (Diff, error) {
	if _, err := files.Parts(name); err != nil {
		return Diff{}, err
	}
	repo, reason, err := discover(ctx, store)
	if err != nil {
		return Diff{}, err
	}
	if reason != "" {
		return Diff{}, ErrUnavailable
	}
	changes, err := collect(ctx, store, repo, false)
	if err != nil {
		return Diff{}, err
	}
	var change *Change
	for i := range changes {
		if changes[i].Path == name {
			change = &changes[i]
			break
		}
	}
	if change == nil {
		return Diff{}, ErrNoChange
	}
	return changeDiff(ctx, store, repo, name, change.Status)
}

func changeDiff(ctx context.Context, store *files.Store, repo repository, name, status string) (Diff, error) {
	var oldContent []byte
	var err error
	if !repo.unborn && status != "added" {
		oldContent, err = run(ctx, repo.root, "cat-file", "blob", repo.head+":"+repo.path(name))
		if err != nil {
			return Diff{}, err
		}
	}
	var newContent []byte
	if status != "deleted" {
		current, readErr := store.ReadText(name)
		if errors.Is(readErr, files.ErrBinary) {
			return Diff{Path: name, Kind: "binary"}, nil
		}
		if readErr != nil {
			return Diff{}, readErr
		}
		newContent = []byte(current)
	}
	if !validText(oldContent) {
		return Diff{Path: name, Kind: "binary"}, nil
	}
	if status == "added" {
		return textDiff(name, addedPatch(name, string(newContent)))
	}
	if status == "deleted" {
		return textDiff(name, deletedPatch(name, string(oldContent)))
	}
	if bytes.Equal(oldContent, newContent) {
		return textDiff(name, fmt.Sprintf("diff --git a/%s b/%s\nFile metadata changed.\n", name, name))
	}
	patch, err := compareSnapshots(ctx, repo.root, name, oldContent, newContent)
	if err != nil {
		return Diff{}, err
	}
	return textDiff(name, patch)
}

func countChange(ctx context.Context, store *files.Store, repo repository, change Change) lineCounts {
	key := store.Path + "\x00" + change.Path + "\x00" + change.Revision
	statsCache.Lock()
	if cached, ok := statsCache.values[key]; ok {
		statsCache.Unlock()
		return cached
	}
	statsCache.Unlock()
	var counts lineCounts
	diff, err := changeDiff(ctx, store, repo, change.Path, change.Status)
	if err == nil && diff.Kind == "text" {
		added, deleted := 0, 0
		inHunk := false
		for _, line := range strings.Split(diff.Patch, "\n") {
			if strings.HasPrefix(line, "@@ ") {
				inHunk = true
				continue
			}
			if !inHunk {
				continue
			}
			if strings.HasPrefix(line, "+") {
				added++
			}
			if strings.HasPrefix(line, "-") {
				deleted++
			}
		}
		counts = lineCounts{&added, &deleted}
	}
	if err != nil && !errors.Is(err, ErrTooLarge) {
		return counts
	}
	statsCache.Lock()
	if len(statsCache.values) >= 4000 {
		statsCache.values = make(map[string]lineCounts)
	}
	statsCache.values[key] = counts
	statsCache.Unlock()
	return counts
}

func validText(content []byte) bool {
	if !utf8.Valid(content) {
		return false
	}
	for _, c := range content {
		if c < 0x20 && c != '\n' && c != '\r' && c != '\t' && c != '\f' {
			return false
		}
	}
	return true
}

func textDiff(name, patch string) (Diff, error) {
	if len(patch) > maxOutput {
		return Diff{}, ErrTooLarge
	}
	return Diff{Path: name, Kind: "text", Patch: patch}, nil
}

func compareSnapshots(ctx context.Context, root, name string, oldContent, newContent []byte) (string, error) {
	dir, err := os.MkdirTemp("", "markport-diff-")
	if err != nil {
		return "", err
	}
	defer os.RemoveAll(dir)
	before := filepath.Join(dir, "before")
	after := filepath.Join(dir, "after")
	if err := os.WriteFile(before, oldContent, 0600); err != nil {
		return "", err
	}
	if err := os.WriteFile(after, newContent, 0600); err != nil {
		return "", err
	}
	output, err := runCommand(ctx, root, true, "diff", "--no-index", "--no-color", "--no-ext-diff", "--no-textconv", "--", before, after)
	if err != nil {
		return "", err
	}
	patch := string(output)
	start := strings.Index(patch, "\n@@ ")
	if start < 0 {
		return fmt.Sprintf("diff --git a/%s b/%s\nFile content changed.\n", name, name), nil
	}
	return fmt.Sprintf("diff --git a/%s b/%s\n--- a/%s\n+++ b/%s%s", name, name, name, name, patch[start:]), nil
}

func addedPatch(name, content string) string {
	lines := strings.SplitAfter(content, "\n")
	if len(lines) > 0 && lines[len(lines)-1] == "" {
		lines = lines[:len(lines)-1]
	}
	var b strings.Builder
	fmt.Fprintf(&b, "diff --git a/%s b/%s\nnew file mode 100644\n--- /dev/null\n+++ b/%s\n@@ -0,0 +1,%d @@\n", name, name, name, len(lines))
	for _, line := range lines {
		b.WriteByte('+')
		b.WriteString(line)
		if !strings.HasSuffix(line, "\n") {
			b.WriteString("\n\\ No newline at end of file\n")
		}
	}
	return b.String()
}

func deletedPatch(name, content string) string {
	lines := strings.SplitAfter(content, "\n")
	if len(lines) > 0 && lines[len(lines)-1] == "" {
		lines = lines[:len(lines)-1]
	}
	var b strings.Builder
	fmt.Fprintf(&b, "diff --git a/%s b/%s\ndeleted file mode 100644\n--- a/%s\n+++ /dev/null\n@@ -1,%d +0,0 @@\n", name, name, name, len(lines))
	for _, line := range lines {
		b.WriteByte('-')
		b.WriteString(line)
		if !strings.HasSuffix(line, "\n") {
			b.WriteString("\n\\ No newline at end of file\n")
		}
	}
	return b.String()
}
