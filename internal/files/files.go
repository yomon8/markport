package files

import (
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"runtime"
	"strings"
	"unicode/utf8"
)

const MaxTextSize = 10 << 20

var (
	ErrPath     = errors.New("invalid path")
	ErrType     = errors.New("not a regular file")
	ErrBinary   = errors.New("binary file")
	ErrTooLarge = errors.New("file exceeds size limit")
)

type Node struct {
	Name     string `json:"name"`
	Path     string `json:"path"`
	Type     string `json:"type"`
	Children []Node `json:"children,omitempty"`
}

type Store struct {
	Path string
	root *os.Root
	base *os.File
}

func New(dir string) (*Store, error) {
	abs, err := filepath.Abs(dir)
	if err != nil {
		return nil, err
	}
	abs, err = filepath.EvalSymlinks(abs)
	if err != nil {
		return nil, err
	}
	info, err := os.Stat(abs)
	if err != nil {
		return nil, err
	}
	if !info.IsDir() {
		return nil, fmt.Errorf("%s: not a directory", dir)
	}
	r, err := os.OpenRoot(abs)
	if err != nil {
		return nil, err
	}
	b, err := r.Open(".")
	if err != nil {
		r.Close()
		return nil, err
	}
	return &Store{Path: abs, root: r, base: b}, nil
}

func (s *Store) Close() error {
	e := s.base.Close()
	if x := s.root.Close(); e == nil {
		e = x
	}
	return e
}

func Parts(name string) ([]string, error) {
	if name == "" || filepath.IsAbs(name) || strings.Contains(name, "\\") || strings.ContainsRune(name, 0) {
		return nil, ErrPath
	}
	parts := strings.Split(name, "/")
	for _, p := range parts {
		if p == "" || p == "." || p == ".." || Excluded(p) {
			return nil, ErrPath
		}
		if runtime.GOOS == "windows" && (strings.Contains(p, ":") || strings.HasSuffix(p, ".") || strings.HasSuffix(p, " ") || windowsReserved(p)) {
			return nil, ErrPath
		}
	}
	return parts, nil
}

func windowsReserved(name string) bool {
	stem := strings.TrimRight(strings.ToUpper(strings.SplitN(name, ".", 2)[0]), " .")
	switch stem {
	case "CON", "PRN", "AUX", "NUL", "CONIN$", "CONOUT$":
		return true
	}
	if len(stem) == 4 && (strings.HasPrefix(stem, "COM") || strings.HasPrefix(stem, "LPT")) && stem[3] >= '1' && stem[3] <= '9' {
		return true
	}
	for _, suffix := range []string{"¹", "²", "³"} {
		if stem == "COM"+suffix || stem == "LPT"+suffix {
			return true
		}
	}
	return false
}

func Excluded(name string) bool {
	for _, excluded := range []string{".git", "node_modules", ".venv"} {
		if name == excluded || runtime.GOOS == "windows" && strings.EqualFold(name, excluded) {
			return true
		}
	}
	return false
}

func (s *Store) Open(name string) (*os.File, error) {
	parts, err := Parts(name)
	if err != nil {
		return nil, err
	}
	return s.openParts(parts, false)
}

func (s *Store) OpenDir(name string) (*os.File, error) {
	if name == "" {
		return s.openParts(nil, true)
	}
	parts, err := Parts(name)
	if err != nil {
		return nil, err
	}
	return s.openParts(parts, true)
}

func (s *Store) Read(name string, max int64) ([]byte, error) {
	f, err := s.Open(name)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() {
		return nil, ErrType
	}
	return readBounded(f, info.Size(), max)
}

func readBounded(reader io.Reader, observedSize, max int64) ([]byte, error) {
	if observedSize > max {
		return nil, fmt.Errorf("%w: %d MiB limit (actual %.1f MiB)", ErrTooLarge, max>>20, float64(observedSize)/(1<<20))
	}
	b, err := io.ReadAll(io.LimitReader(reader, max+1))
	if err != nil {
		return nil, err
	}
	if int64(len(b)) > max {
		return nil, fmt.Errorf("%w: %d MiB", ErrTooLarge, max>>20)
	}
	return b, nil
}

func (s *Store) ReadText(name string) (string, error) {
	b, err := s.Read(name, MaxTextSize)
	if err != nil {
		return "", err
	}
	if !utf8.Valid(b) {
		return "", ErrBinary
	}
	for _, c := range b {
		if c < 0x20 && c != '\n' && c != '\r' && c != '\t' && c != '\f' {
			return "", ErrBinary
		}
	}
	return string(b), nil
}

func (s *Store) Tree() ([]Node, error) { return s.tree("") }

func (s *Store) tree(dir string) ([]Node, error) {
	f, err := s.OpenDir(dir)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	entries, err := f.ReadDir(-1)
	if err != nil {
		return nil, err
	}
	nodes := make([]Node, 0, len(entries))
	for _, entry := range entries {
		name := entry.Name()
		if Excluded(name) {
			continue
		}
		rel := path.Join(dir, name)
		info, err := s.root.Lstat(rel)
		if err != nil || info.Mode()&fs.ModeSymlink != 0 {
			continue
		}
		if info.IsDir() {
			children, err := s.tree(rel)
			if err != nil {
				continue
			}
			nodes = append(nodes, Node{Name: name, Path: rel, Type: "directory", Children: children})
		} else if info.Mode().IsRegular() {
			f, err := s.Open(rel)
			if err != nil {
				continue
			}
			_ = f.Close()
			nodes = append(nodes, Node{Name: name, Path: rel, Type: "file"})
		}
	}
	return nodes, nil
}
