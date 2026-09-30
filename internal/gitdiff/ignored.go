package gitdiff

import (
	"bytes"
	"context"
	"sort"
	"strings"

	"github.com/markport/markport/internal/files"
)

// Ignored returns the entries of names (slash-separated, relative to the store
// root) that Git ignores. One git process checks every name. When Git or the
// repository is unavailable it returns no names, so callers keep working.
func Ignored(ctx context.Context, store *files.Store, names []string) ([]string, error) {
	if len(names) == 0 {
		return nil, nil
	}
	repo, reason, err := discover(ctx, store)
	if err != nil {
		return nil, err
	}
	if reason != "" {
		return nil, nil
	}
	var input bytes.Buffer
	for _, name := range names {
		// The "./" prefix stops names such as ":x" from being read as pathspec magic.
		input.WriteString("./" + repo.path(name))
		input.WriteByte(0)
	}
	output, err := runInput(ctx, repo.root, true, input.Bytes(), "check-ignore", "--stdin", "-z")
	if err != nil {
		return nil, err
	}
	ignored := make([]string, 0)
	for _, item := range strings.Split(string(output), "\x00") {
		item = strings.TrimPrefix(item, "./")
		if item == "" || !strings.HasPrefix(item, repo.prefix) {
			continue
		}
		ignored = append(ignored, strings.TrimPrefix(item, repo.prefix))
	}
	sort.Strings(ignored)
	return ignored, nil
}
