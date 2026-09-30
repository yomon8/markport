package update

import (
	"fmt"
	"golang.org/x/sys/windows"
)

func lockTarget(target string) (func(), error) {
	f, err := openLockFile(target)
	if err != nil {
		return nil, err
	}
	var overlapped windows.Overlapped
	flags := uint32(windows.LOCKFILE_EXCLUSIVE_LOCK | windows.LOCKFILE_FAIL_IMMEDIATELY)
	if err := windows.LockFileEx(windows.Handle(f.Fd()), flags, 0, 1, 0, &overlapped); err != nil {
		f.Close()
		return nil, fmt.Errorf("cannot lock installation; another update may be running: %w", err)
	}
	return func() { _ = windows.UnlockFileEx(windows.Handle(f.Fd()), 0, 1, 0, &overlapped); _ = f.Close() }, nil
}
