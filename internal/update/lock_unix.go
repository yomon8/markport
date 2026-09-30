//go:build linux || darwin

package update

import (
	"fmt"
	"golang.org/x/sys/unix"
)

func lockTarget(target string) (func(), error) {
	f, err := openLockFile(target)
	if err != nil {
		return nil, err
	}
	if err := unix.Flock(int(f.Fd()), unix.LOCK_EX|unix.LOCK_NB); err != nil {
		f.Close()
		return nil, fmt.Errorf("cannot lock installation; another update may be running: %w", err)
	}
	return func() { _ = unix.Flock(int(f.Fd()), unix.LOCK_UN); _ = f.Close() }, nil
}
