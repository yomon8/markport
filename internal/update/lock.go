package update

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

func openLockFile(target string) (*os.File, error) {
	path := filepath.Join(filepath.Dir(target), "."+filepath.Base(target)+".update.lock")
	if info, err := os.Lstat(path); err == nil {
		if !info.Mode().IsRegular() {
			return nil, errors.New("update lock is not a regular file")
		}
	} else if !os.IsNotExist(err) {
		return nil, err
	}
	f, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return nil, fmt.Errorf("open update lock (check installation permissions): %w", err)
	}
	return f, nil
}
