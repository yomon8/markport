package gitdiff

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io/fs"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/markport/markport/internal/files"
)

const historyPageSize = 50

var ErrCommitNotFound = errors.New("commit is not in the current history")

type Commit struct {
	ID      string `json:"id"`
	Author  string `json:"author"`
	Date    string `json:"date"`
	Subject string `json:"subject"`
}

type HistoryPage struct {
	Available  bool     `json:"available"`
	Reason     string   `json:"reason,omitempty"`
	Head       string   `json:"head,omitempty"`
	Commits    []Commit `json:"commits"`
	NextOffset *int     `json:"nextOffset"`
}

type CommitDetail struct {
	Commit
	Message string   `json:"message"`
	Files   []Change `json:"files"`
}

func validCommitID(id string) bool {
	if len(id) != 40 && len(id) != 64 {
		return false
	}
	for _, c := range id {
		if !((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f')) {
			return false
		}
	}
	return true
}

func historyRepo(ctx context.Context, store *files.Store, id string) (repository, error) {
	repo, reason, err := discover(ctx, store)
	if err != nil {
		return repository{}, err
	}
	if reason != "" || repo.unborn || !validCommitID(id) {
		return repository{}, ErrCommitNotFound
	}
	if _, err := run(ctx, repo.root, "merge-base", "--is-ancestor", id, repo.head); err != nil {
		if errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled) || errors.Is(err, ErrTooLarge) {
			return repository{}, err
		}
		return repository{}, ErrCommitNotFound
	}
	return repo, nil
}

// historyRecords uses NUL separators for metadata and paths. The leading NUL
// in each pretty-print record makes the boundary unambiguous to the parser.
func historyRecords(output []byte, prefix string) ([]Commit, error) {
	result := []Commit{}
	for _, record := range bytes.Split(output, []byte{0, 0}) {
		record = bytes.TrimPrefix(record, []byte{0})
		if len(record) == 0 {
			continue
		}
		fields := bytes.Split(record, []byte{0})
		if len(fields) < 5 || !validCommitID(string(fields[0])) {
			return nil, fmt.Errorf("malformed Git history")
		}
		commit := Commit{ID: string(fields[0]), Author: string(fields[1]), Date: string(fields[2]), Subject: string(fields[3])}
		paths := fields[4:]
		if len(paths) > 0 {
			paths[0] = bytes.TrimPrefix(paths[0], []byte{'\n'})
		}
		for _, path := range paths {
			name := strings.TrimPrefix(string(path), prefix)
			if strings.HasPrefix(string(path), prefix) && validHistoryPath(name) {
				result = append(result, commit)
				break
			}
		}
	}
	return result, nil
}

func validHistoryPath(name string) bool {
	_, err := files.Parts(name)
	return err == nil
}

func History(ctx context.Context, store *files.Store, head string, offset int) (HistoryPage, error) {
	page := HistoryPage{Commits: []Commit{}}
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
	if head == "" {
		head = repo.head
	} else if _, err := historyRepo(ctx, store, head); err != nil {
		return page, err
	}
	page.Head = head
	// Fetch a bounded window and filter paths excluded from the file browser.
	// The offset counts raw Git records so pages remain stable at a pinned HEAD.
	for batch := 0; batch < 5 && len(page.Commits) < historyPageSize; batch++ {
		output, err := run(ctx, repo.root, "log", "--root", "--full-history", "--diff-merges=first-parent", "--name-only", "-z", "--format=%x00%H%x00%an%x00%aI%x00%s", "--max-count=51", "--skip="+strconv.Itoa(offset), head, "--", repo.scope())
		if err != nil {
			return page, err
		}
		records := 0
		if len(output) > 0 {
			parts := bytes.Split(output, []byte{0, 0})
			records = len(parts)
			// The last record is a lookahead, not part of this page.
			if records > historyPageSize {
				output = bytes.Join(parts[:historyPageSize], []byte{0, 0})
			}
		}
		commits, err := historyRecords(output, repo.prefix)
		if err != nil {
			return page, err
		}
		page.Commits = append(page.Commits, commits...)
		if len(page.Commits) > historyPageSize {
			page.Commits = page.Commits[:historyPageSize]
		}
		offset += min(records, 50)
		if records <= 50 {
			page.NextOffset = nil
			break
		}
		page.NextOffset = &offset
		if len(page.Commits) >= historyPageSize {
			break
		}
	}
	return page, nil
}

func commitFiles(ctx context.Context, repo repository, id string) ([]Change, error) {
	parents, err := run(ctx, repo.root, "rev-list", "--parents", "-n", "1", id)
	if err != nil {
		return nil, err
	}
	parts := strings.Fields(string(parents))
	if len(parts) == 0 || parts[0] != id {
		return nil, ErrCommitNotFound
	}
	args := []string{"diff-tree", "--root", "--no-commit-id", "-r", "--name-status", "-z", "--no-renames"}
	if len(parts) > 1 {
		args = []string{"diff", "--name-status", "-z", "--no-renames", parts[1]}
	}
	args = append(args, id, "--", repo.scope())
	output, err := run(ctx, repo.root, args...)
	if err != nil {
		return nil, err
	}
	changes, err := names(output, true)
	if err != nil {
		return nil, err
	}
	result := make([]Change, 0, len(changes))
	for _, change := range changes {
		if !strings.HasPrefix(change.Path, repo.prefix) {
			continue
		}
		change.Path = strings.TrimPrefix(change.Path, repo.prefix)
		if validHistoryPath(change.Path) {
			result = append(result, change)
		}
	}
	return result, nil
}

func CommitInfo(ctx context.Context, store *files.Store, id string) (CommitDetail, error) {
	repo, err := historyRepo(ctx, store, id)
	if err != nil {
		return CommitDetail{}, err
	}
	files, err := commitFiles(ctx, repo, id)
	if err != nil {
		return CommitDetail{}, err
	}
	if len(files) == 0 {
		return CommitDetail{}, ErrCommitNotFound
	}
	output, err := run(ctx, repo.root, "show", "-s", "--format=%H%x00%an%x00%aI%x00%s%x00%B", id)
	if err != nil {
		return CommitDetail{}, err
	}
	fields := bytes.SplitN(output, []byte{0}, 5)
	if len(fields) != 5 || string(fields[0]) != id {
		return CommitDetail{}, fmt.Errorf("malformed Git commit")
	}
	return CommitDetail{Commit: Commit{ID: id, Author: string(fields[1]), Date: string(fields[2]), Subject: string(fields[3])}, Message: strings.TrimSpace(string(fields[4])), Files: files}, nil
}

func CommitFile(ctx context.Context, store *files.Store, id, name string) (Diff, error) {
	if !validHistoryPath(name) {
		return Diff{}, fs.ErrInvalid
	}
	repo, err := historyRepo(ctx, store, id)
	if err != nil {
		return Diff{}, err
	}
	files, err := commitFiles(ctx, repo, id)
	if err != nil {
		return Diff{}, err
	}
	found := false
	for _, file := range files {
		if file.Path == name {
			found = true
			break
		}
	}
	if !found {
		return Diff{}, ErrNoChange
	}
	parents, err := run(ctx, repo.root, "rev-list", "--parents", "-n", "1", id)
	if err != nil {
		return Diff{}, err
	}
	parts := strings.Fields(string(parents))
	args := []string{"diff-tree", "--root", "--no-commit-id", "-r", "-p", "--no-ext-diff", "--no-textconv", "--no-renames", "--no-color"}
	if len(parts) > 1 {
		args = []string{"diff", "--no-ext-diff", "--no-textconv", "--no-renames", "--no-color", parts[1]}
	}
	args = append(args, id, "--", repo.path(name))
	patch, err := run(ctx, repo.root, args...)
	if err != nil {
		return Diff{}, err
	}
	if !utf8.Valid(patch) || bytes.Contains(patch, []byte("\nBinary files ")) {
		return Diff{Path: name, Kind: "binary"}, nil
	}
	return textDiff(name, string(patch))
}
