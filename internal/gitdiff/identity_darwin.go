package gitdiff

import (
	"io/fs"
	"os"
	"syscall"
)

type fileIdentity struct {
	device, inode  uint64
	seconds, nanos int64
}

func identifyFile(_ *os.File, info fs.FileInfo) (fileIdentity, bool) {
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !ok {
		return fileIdentity{}, false
	}
	return fileIdentity{uint64(stat.Dev), stat.Ino, stat.Ctimespec.Sec, stat.Ctimespec.Nsec}, true
}
