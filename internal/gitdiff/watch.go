package gitdiff

import (
	"context"
	"os"
	"path/filepath"
	"strings"

	"github.com/markport/markport/internal/files"
)

// WatchDirs resolves metadata directories without importing gitdiff from files.
// Linked worktrees keep their index/HEAD separately from shared branch refs.
func WatchDirs(ctx context.Context, store *files.Store) ([]string, error) {
	repo, reason, err := discover(ctx, store)
	if err != nil || reason != "" {
		return nil, err
	}
	gitDir, err := run(ctx, repo.root, "rev-parse", "--absolute-git-dir")
	if err != nil {
		return nil, err
	}
	commonDir, err := run(ctx, repo.root, "rev-parse", "--git-common-dir")
	if err != nil {
		return nil, err
	}
	resolve := func(value []byte) (string, error) {
		directory := strings.TrimSpace(string(value))
		if !filepath.IsAbs(directory) {
			directory = filepath.Join(repo.root, directory)
		}
		return filepath.EvalSymlinks(directory)
	}
	gitPath, err := resolve(gitDir)
	if err != nil {
		return nil, err
	}
	commonPath, err := resolve(commonDir)
	if err != nil {
		return nil, err
	}
	headsDir := filepath.Join(commonPath, "refs", "heads")
	dirs := []string{gitPath, headsDir}
	const maxHeadWatchDirs = 256
	var walkHeads func(string)
	walkHeads = func(dir string) {
		if len(dirs)-2 >= maxHeadWatchDirs || ctx.Err() != nil {
			return
		}
		entries, err := os.ReadDir(dir)
		if err != nil {
			return
		}
		for _, entry := range entries {
			if len(dirs)-2 >= maxHeadWatchDirs || ctx.Err() != nil {
				return
			}
			if entry.Type()&os.ModeSymlink != 0 || !entry.IsDir() {
				continue
			}
			child := filepath.Join(dir, entry.Name())
			info, err := os.Lstat(child)
			if err != nil || info.Mode()&os.ModeSymlink != 0 || !info.IsDir() {
				continue
			}
			dirs = append(dirs, child)
			walkHeads(child)
		}
	}
	walkHeads(headsDir)
	return dirs, nil
}
