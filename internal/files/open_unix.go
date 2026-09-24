//go:build linux || darwin

package files

import (
	"golang.org/x/sys/unix"
	"os"
	"path"
	"path/filepath"
)

func (s *Store) openParts(parts []string, directory bool) (*os.File, error) {
	fd, err := unix.Openat(int(s.base.Fd()), ".", unix.O_RDONLY|unix.O_CLOEXEC|unix.O_DIRECTORY|unix.O_NOFOLLOW|unix.O_NONBLOCK, 0)
	if err != nil {
		return nil, err
	}
	if len(parts) == 0 {
		return os.NewFile(uintptr(fd), s.Path), nil
	}
	for i, p := range parts {
		flags := unix.O_RDONLY | unix.O_CLOEXEC | unix.O_NOFOLLOW | unix.O_NONBLOCK
		if i < len(parts)-1 || directory {
			flags |= unix.O_DIRECTORY
		}
		next, e := unix.Openat(fd, p, flags, 0)
		unix.Close(fd)
		if e != nil {
			return nil, e
		}
		fd = next
		var st unix.Stat_t
		if e = unix.Fstat(fd, &st); e != nil {
			unix.Close(fd)
			return nil, e
		}
		if i < len(parts)-1 || directory {
			if st.Mode&unix.S_IFMT != unix.S_IFDIR {
				unix.Close(fd)
				return nil, ErrType
			}
		} else if st.Mode&unix.S_IFMT != unix.S_IFREG {
			unix.Close(fd)
			return nil, ErrType
		}
	}
	return os.NewFile(uintptr(fd), filepath.Join(s.Path, filepath.FromSlash(path.Join(parts...)))), nil
}
