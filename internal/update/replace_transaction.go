package update

import (
	"fmt"
	"path/filepath"
)

// replaceWindows keeps the old executable recoverable until installation succeeds.
func replaceWindows(staged, target string, rename func(string, string) error, remove func(string) error) (string, error) {
	backup := filepath.Join(filepath.Dir(staged), "previous.exe")
	if err := rename(target, backup); err != nil {
		return "", err
	}
	if err := rename(staged, target); err != nil {
		if rollback := rename(backup, target); rollback != nil {
			return backup, fmt.Errorf("installation failed: %v; restoring old executable failed: %v; recover manually by moving %s to %s", err, rollback, backup, target)
		}
		return "", fmt.Errorf("installation failed; previous executable restored: %w", err)
	}
	if err := remove(backup); err != nil {
		return backup, nil
	}
	return "", nil
}
