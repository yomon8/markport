package gitdiff

import (
	"context"
	"crypto/sha256"
	"io"
	"io/fs"
	"os"
	"sync"
)

type hashKey struct {
	path        string
	mtime, size int64
	identity    fileIdentity
}

var contentHashes = struct {
	sync.Mutex
	values map[hashKey][sha256.Size]byte
}{values: make(map[hashKey][sha256.Size]byte)}

func worktreeHash(ctx context.Context, file *os.File, info fs.FileInfo, path string) ([sha256.Size]byte, error) {
	var digest [sha256.Size]byte
	if err := ctx.Err(); err != nil {
		return digest, err
	}
	identity, reliable := identifyFile(file, info)
	key := hashKey{path, info.ModTime().UnixNano(), info.Size(), identity}
	if reliable {
		contentHashes.Lock()
		cached, found := contentHashes.values[key]
		contentHashes.Unlock()
		if found {
			return cached, nil
		}
	}
	hash := sha256.New()
	if _, err := io.Copy(hash, file); err != nil {
		return digest, err
	}
	copy(digest[:], hash.Sum(nil))
	if err := ctx.Err(); err != nil {
		return digest, err
	}
	// Do not cache a read that overlapped a write. The next poll must reread it.
	after, err := file.Stat()
	if err != nil {
		return digest, err
	}
	afterIdentity, afterReliable := identifyFile(file, after)
	if reliable && afterReliable && identity == afterIdentity && info.Size() == after.Size() && info.ModTime() == after.ModTime() {
		contentHashes.Lock()
		if len(contentHashes.values) >= 4000 {
			contentHashes.values = make(map[hashKey][sha256.Size]byte)
		}
		contentHashes.values[key] = digest
		contentHashes.Unlock()
	}
	return digest, nil
}
