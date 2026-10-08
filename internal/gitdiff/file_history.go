package gitdiff

import (
	"bytes"
	"context"
	"crypto/sha256"
	"fmt"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/markport/markport/internal/files"
)

type FileCommit struct {
	Commit
	Path   string `json:"path"`
	Status string `json:"status"`
}

type FileHistoryPage struct {
	Available  bool         `json:"available"`
	Reason     string       `json:"reason,omitempty"`
	Head       string       `json:"head,omitempty"`
	Commits    []FileCommit `json:"commits"`
	NextOffset *int         `json:"nextOffset"`
}

type FileRevision struct {
	Commit
	Path    string `json:"path"`
	Kind    string `json:"kind"`
	Content string `json:"content"`
}

type BlameLine struct {
	Line         int    `json:"line"`
	OriginalLine int    `json:"originalLine"`
	Commit       string `json:"commit"`
	Author       string `json:"author"`
	Date         string `json:"date"`
	Subject      string `json:"subject"`
	Path         string `json:"path,omitempty"`
	Content      string `json:"content"`
	Uncommitted  bool   `json:"uncommitted"`
}

type BlameResult struct {
	Available bool        `json:"available"`
	Reason    string      `json:"reason,omitempty"`
	Head      string      `json:"head,omitempty"`
	Path      string      `json:"path"`
	Lines     []BlameLine `json:"lines"`
}

func scopedFile(repo repository, name string) (string, bool) {
	if !strings.HasPrefix(name, repo.prefix) {
		return "", false
	}
	name = strings.TrimPrefix(name, repo.prefix)
	return name, validHistoryPath(name)
}

// indexPath only follows renames Git has already recorded in the index. It
// never guesses the identity of an untracked file from similar contents.
func indexPath(ctx context.Context, repo repository, name string) (string, error) {
	if repo.unborn {
		return repo.path(name), nil
	}
	output, err := run(ctx, repo.root, "diff", "--cached", "--name-status", "-z", "--find-renames", "--no-ext-diff", "--no-textconv", repo.head)
	if err != nil {
		return "", err
	}
	for fields := bytes.Split(output, []byte{0}); len(fields) > 1; {
		status := string(fields[0])
		fields = fields[1:]
		if strings.HasPrefix(status, "R") || strings.HasPrefix(status, "C") {
			if len(fields) < 2 {
				return "", fmt.Errorf("malformed Git rename")
			}
			old, next := string(fields[0]), string(fields[1])
			fields = fields[2:]
			if strings.HasPrefix(status, "R") && next == repo.path(name) {
				if _, ok := scopedFile(repo, old); ok {
					return old, nil
				}
			}
		} else {
			fields = fields[1:]
		}
	}
	return repo.path(name), nil
}

func FileHistory(ctx context.Context, store *files.Store, name, head string, offset int) (FileHistoryPage, error) {
	page := FileHistoryPage{Commits: []FileCommit{}}
	if _, err := files.Parts(name); err != nil {
		return page, err
	}
	if offset < 0 || offset > 100000 {
		return page, files.ErrPath
	}
	repo, reason, err := discover(ctx, store)
	if err != nil {
		return page, err
	}
	if reason != "" {
		page.Reason = reason
		return page, nil
	}
	page.Available = true
	if repo.unborn {
		return page, nil
	}
	if head != "" {
		repo, err = historyRepo(ctx, store, head)
		if err != nil {
			return page, err
		}
		repo.head = head
	}
	page.Head = repo.head
	path, err := indexPath(ctx, repo, name)
	if err != nil {
		return page, err
	}
	// Replay the prefix, including skipped records, to retain rename boundaries
	// between pages. Both the record window and command output are bounded.
	output, err := run(ctx, repo.root, "log", "--follow", "--root", "--full-history", "--diff-merges=first-parent", "--find-renames", "--name-status", "-z", "--format=%x00%H%x00%an%x00%aI%x00%s", "--max-count="+strconv.Itoa(offset+historyPageSize+1), repo.head, "--", path)
	if err != nil {
		return page, err
	}
	commits, err := fileHistoryRecords(output, repo)
	if err != nil {
		return page, err
	}
	if offset >= len(commits) {
		return page, nil
	}
	end := min(len(commits), offset+historyPageSize)
	page.Commits = commits[offset:end]
	if end < len(commits) {
		page.NextOffset = &end
	}
	return page, nil
}

func fileHistoryRecords(output []byte, repo repository) ([]FileCommit, error) {
	result := []FileCommit{}
	for _, record := range bytes.Split(output, []byte{0, 0}) {
		record = bytes.TrimPrefix(record, []byte{0})
		if len(record) == 0 {
			continue
		}
		fields := bytes.Split(record, []byte{0})
		if len(fields) < 6 || !validCommitID(string(fields[0])) {
			return nil, fmt.Errorf("malformed Git file history")
		}
		status := strings.TrimPrefix(string(fields[4]), "\n")
		path := string(fields[5])
		boundary := false
		kind := "modified"
		switch {
		case strings.HasPrefix(status, "R"):
			if len(fields) < 7 {
				return nil, fmt.Errorf("malformed Git file rename")
			}
			_, ok := scopedFile(repo, path)
			boundary = !ok
			path = string(fields[6])
			kind = "renamed"
		case status == "A":
			kind = "added"
		case status == "D":
			kind = "deleted"
		}
		name, ok := scopedFile(repo, path)
		if !ok {
			break
		}
		result = append(result, FileCommit{Commit: Commit{ID: string(fields[0]), Author: string(fields[1]), Date: string(fields[2]), Subject: string(fields[3])}, Path: name, Status: kind})
		if boundary {
			break
		}
	}
	return result, nil
}

func revisionInfo(ctx context.Context, repo repository, id string) (Commit, error) {
	output, err := run(ctx, repo.root, "show", "-s", "--format=%H%x00%an%x00%aI%x00%s", id)
	if err != nil {
		return Commit{}, err
	}
	fields := bytes.SplitN(bytes.TrimSuffix(output, []byte{'\n'}), []byte{0}, 4)
	if len(fields) != 4 || string(fields[0]) != id {
		return Commit{}, fmt.Errorf("malformed Git commit")
	}
	return Commit{ID: id, Author: string(fields[1]), Date: string(fields[2]), Subject: string(fields[3])}, nil
}

func regularBlob(ctx context.Context, repo repository, id, name string) (bool, error) {
	// ls-tree does not follow symlinks, including symlinks in parent components.
	output, err := run(ctx, repo.root, "ls-tree", "-z", id, "--", repo.path(name))
	if err != nil {
		return false, err
	}
	if len(output) == 0 {
		return false, nil
	}
	fields := bytes.SplitN(bytes.TrimSuffix(output, []byte{0}), []byte{'\t'}, 2)
	if len(fields) != 2 || string(fields[1]) != repo.path(name) {
		return false, files.ErrType
	}
	mode := strings.Fields(string(fields[0]))
	if len(mode) != 3 || mode[1] != "blob" || (mode[0] != "100644" && mode[0] != "100755") {
		return false, files.ErrType
	}
	return true, nil
}

func textContent(content []byte) bool {
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

func FileAtCommit(ctx context.Context, store *files.Store, id, name string) (FileRevision, error) {
	result := FileRevision{Path: name, Kind: "missing"}
	if _, err := files.Parts(name); err != nil {
		return result, err
	}
	repo, err := historyRepo(ctx, store, id)
	if err != nil {
		return result, err
	}
	result.Commit, err = revisionInfo(ctx, repo, id)
	if err != nil {
		return result, err
	}
	exists, err := regularBlob(ctx, repo, id, name)
	if err != nil || !exists {
		return result, err
	}
	content, err := run(ctx, repo.root, "cat-file", "blob", id+":"+repo.path(name))
	if err != nil {
		return result, err
	}
	result.Kind = "binary"
	if textContent(content) {
		result.Kind = "text"
		result.Content = string(content)
	}
	return result, nil
}

func FileCommitDiff(ctx context.Context, store *files.Store, id, name string) (Diff, error) {
	if _, err := files.Parts(name); err != nil {
		return Diff{}, err
	}
	repo, err := historyRepo(ctx, store, id)
	if err != nil {
		return Diff{}, err
	}
	parents, err := run(ctx, repo.root, "rev-list", "--parents", "-n", "1", id)
	if err != nil {
		return Diff{}, err
	}
	parts := strings.Fields(string(parents))
	if len(parts) == 0 || parts[0] != id {
		return Diff{}, ErrCommitNotFound
	}
	args := []string{"diff-tree", "--root", "--no-commit-id", "-r"}
	if len(parts) > 1 {
		args = []string{"diff", parts[1]}
	}
	safe := []string{"--no-ext-diff", "--no-textconv", "--no-color", "--find-renames"}
	// Detect the rename before filtering to a path; filtering first can turn a
	// rename into an addition and lose the original side of the diff.
	output, err := run(ctx, repo.root, append(append(append([]string{}, args...), safe...), "--name-status", "-z", id)...)
	if err != nil {
		return Diff{}, err
	}
	oldName := ""
	found := false
	boundary := false
	for fields := bytes.Split(output, []byte{0}); len(fields) > 1; {
		status := string(fields[0])
		fields = fields[1:]
		current := string(fields[0])
		fields = fields[1:]
		if strings.HasPrefix(status, "R") || strings.HasPrefix(status, "C") {
			if len(fields) == 0 {
				return Diff{}, fmt.Errorf("malformed Git rename")
			}
			next := string(fields[0])
			fields = fields[1:]
			if next == repo.path(name) {
				found = true
				if _, ok := scopedFile(repo, current); ok {
					oldName = current
				} else {
					boundary = true
				}
			}
		} else if current == repo.path(name) {
			found = true
		}
	}
	if !found {
		return Diff{}, ErrNoChange
	}
	// Reject tree entries such as symlinks and submodules on both sides.
	for _, revision := range []string{id, firstParent(parts)} {
		if revision == "" {
			continue
		}
		if _, err := regularBlob(ctx, repo, revision, name); err != nil {
			return Diff{}, err
		}
	}
	if oldName != "" && len(parts) > 1 {
		if _, err := regularBlob(ctx, repo, parts[1], strings.TrimPrefix(oldName, repo.prefix)); err != nil {
			return Diff{}, err
		}
	}
	if boundary {
		// A move into the displayed root is an addition here. Never expose the
		// previous contents or even the previous path outside the browsing scope.
		empty, err := runInput(ctx, repo.root, false, []byte{}, "hash-object", "-t", "tree", "--stdin")
		if err != nil {
			return Diff{}, err
		}
		args = []string{"diff", strings.TrimSpace(string(empty))}
	}
	patchArgs := append(append(append([]string{}, args...), safe...), "-p", id, "--", repo.path(name))
	if oldName != "" {
		patchArgs = append(patchArgs, oldName)
	}
	patch, err := run(ctx, repo.root, patchArgs...)
	if err != nil {
		return Diff{}, err
	}
	if !utf8.Valid(patch) || bytes.Contains(patch, []byte("\nBinary files ")) {
		return Diff{Path: name, Kind: "binary"}, nil
	}
	return textDiff(name, string(patch))
}

func firstParent(parts []string) string {
	if len(parts) > 1 {
		return parts[1]
	}
	return ""
}

// Cache only immutable attribution results. The key includes the exact safely
// read contents, HEAD, and the index rename source. It cannot outlive an edit.
var fileBlameCache = struct {
	sync.Mutex
	values map[[32]byte]BlameResult
}{values: make(map[[32]byte]BlameResult)}

func Blame(ctx context.Context, store *files.Store, name string) (BlameResult, error) {
	result := BlameResult{Path: name, Lines: []BlameLine{}}
	if _, err := files.Parts(name); err != nil {
		return result, err
	}
	repo, reason, err := discover(ctx, store)
	if err != nil {
		return result, err
	}
	if reason != "" {
		result.Reason = reason
		return result, nil
	}
	result.Available = true
	result.Head = repo.head
	content, err := store.ReadText(name)
	if err != nil {
		return result, err
	}
	if content == "" {
		return result, nil
	}
	path, err := indexPath(ctx, repo, name)
	if err != nil {
		return result, err
	}
	exists := false
	if !repo.unborn {
		exists, err = regularBlob(ctx, repo, repo.head, strings.TrimPrefix(path, repo.prefix))
	}
	if err != nil {
		return result, err
	}
	if !exists {
		for i, line := range strings.Split(strings.TrimSuffix(content, "\n"), "\n") {
			result.Lines = append(result.Lines, BlameLine{Line: i + 1, OriginalLine: i + 1, Content: line, Uncommitted: true})
		}
		return result, nil
	}
	cacheKey := sha256.Sum256([]byte(repo.root + "\x00" + repo.prefix + "\x00" + repo.head + "\x00" + path + "\x00" + name + "\x00" + content))
	fileBlameCache.Lock()
	cached, found := fileBlameCache.values[cacheKey]
	fileBlameCache.Unlock()
	if found {
		return cached, nil
	}
	output, err := runInput(ctx, repo.root, false, []byte(content), "blame", "--line-porcelain", "--root", "--no-textconv", "--contents", "-", "--", path)
	if err != nil {
		return result, err
	}
	result.Lines, err = blameRecords(output, repo)
	if err != nil {
		return result, err
	}
	// --contents works with older Git versions without an explicit revision.
	// Refuse to label data from a concurrently changed HEAD as the old HEAD.
	head, err := run(ctx, repo.root, "rev-parse", "--verify", "HEAD")
	if err != nil {
		return result, err
	}
	if strings.TrimSpace(string(head)) != repo.head {
		return result, fmt.Errorf("HEAD changed while reading blame; retry")
	}
	sourceLines := strings.Split(strings.TrimSuffix(content, "\n"), "\n")
	if len(result.Lines) != len(sourceLines) {
		return result, fmt.Errorf("Git blame does not match the source")
	}
	for i, line := range result.Lines {
		if line.Content != sourceLines[i] && line.Content != strings.TrimSuffix(sourceLines[i], "\r") {
			return result, fmt.Errorf("Git blame does not match the source")
		}
		// Git's clean conversion may normalize CRLF. Keep the safely read source
		// as the display text while retaining Git's matching line attribution.
		result.Lines[i].Content = sourceLines[i]
	}
	fileBlameCache.Lock()
	if len(fileBlameCache.values) >= 8 {
		clear(fileBlameCache.values)
	}
	fileBlameCache.values[cacheKey] = result
	fileBlameCache.Unlock()
	return result, nil
}

func blameRecords(output []byte, repo repository) ([]BlameLine, error) {
	result := []BlameLine{}
	var current BlameLine
	for _, line := range strings.Split(string(output), "\n") {
		if strings.HasPrefix(line, "\t") {
			current.Content = line[1:]
			result = append(result, current)
			current = BlameLine{}
			continue
		}
		if line == "" {
			continue
		}
		key, value, _ := strings.Cut(line, " ")
		switch key {
		case "author":
			current.Author = value
		case "author-time":
			seconds, err := strconv.ParseInt(value, 10, 64)
			if err != nil {
				return nil, fmt.Errorf("malformed Git blame date")
			}
			current.Date = time.Unix(seconds, 0).UTC().Format(time.RFC3339)
		case "summary":
			current.Subject = value
		case "filename":
			// Porcelain uses Git's C-style quoting for unusual path names.
			if strings.HasPrefix(value, "\"") {
				decoded, err := strconv.Unquote(value)
				if err != nil {
					return nil, fmt.Errorf("malformed Git blame path")
				}
				value = decoded
			}
			if name, ok := scopedFile(repo, value); ok {
				current.Path = name
			}
		default:
			if validCommitID(key) {
				fields := strings.Fields(value)
				if len(fields) < 2 {
					return nil, fmt.Errorf("malformed Git blame header")
				}
				original, e1 := strconv.Atoi(fields[0])
				final, e2 := strconv.Atoi(fields[1])
				if e1 != nil || e2 != nil || original < 1 || final != len(result)+1 {
					return nil, fmt.Errorf("malformed Git blame line")
				}
				current.Commit = key
				current.OriginalLine = original
				current.Line = final
				current.Uncommitted = strings.Trim(key, "0") == ""
			}
		}
	}
	for _, line := range result {
		if line.Line == 0 {
			return nil, fmt.Errorf("malformed Git blame record")
		}
	}
	return result, nil
}
