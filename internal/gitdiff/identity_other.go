//go:build !linux && !darwin && !windows

package gitdiff

import (
	"io/fs"
	"os"
)

type fileIdentity struct{}

// Without change time and identity, a restored mtime cannot validate a cache.
func identifyFile(_ *os.File, _ fs.FileInfo) (fileIdentity, bool) { return fileIdentity{}, false }
