package files

import (
	"context"
	"errors"
	"io"
	"io/fs"
	"path"
	"strings"
	"unicode/utf8"
)

const (
	MaxSearchFiles   = 2000
	MaxSearchEntries = 10000
	MaxSearchBytes   = 64 << 20
	MaxSearchMatches = 100
)

type ContentMatch struct {
	Path   string `json:"path"`
	Line   int    `json:"line"`
	Before string `json:"before"`
	Text   string `json:"text"`
	After  string `json:"after"`
}

type ContentSearch struct {
	Matches      []ContentMatch `json:"matches"`
	FilesScanned int            `json:"filesScanned"`
	BytesRead    int64          `json:"bytesRead"`
	Limit        string         `json:"limit,omitempty"`
}

type contextReader struct {
	ctx context.Context
	r   io.Reader
}

func (r contextReader) Read(p []byte) (int, error) {
	if err := r.ctx.Err(); err != nil {
		return 0, err
	}
	return r.r.Read(p)
}

func searchSnippet(line string, start, end int) string {
	left := []rune(line[:start])
	middle := []rune(line[start:end])
	right := []rune(line[end:])
	if len(left) > 100 {
		left = left[len(left)-100:]
	}
	if len(middle) > 160 {
		middle = middle[:160]
	}
	if len(right) > 100 {
		right = right[:100]
	}
	return strings.TrimSpace(string(left) + string(middle) + string(right))
}

func contextLine(line string) string {
	line = strings.TrimSpace(line)
	runes := []rune(line)
	if len(runes) > 160 {
		return string(runes[:160]) + "…"
	}
	return line
}

// SearchContent scans the requested directory on each call. Every open stays
// inside Store's root, including when entries change during a scan.
func (s *Store) SearchContent(ctx context.Context, dir, query string) (ContentSearch, error) {
	result := ContentSearch{Matches: []ContentMatch{}}
	query = strings.TrimSpace(query)
	if query == "" || utf8.RuneCountInString(query) > 200 {
		return result, ErrPath
	}
	if dir != "" {
		if _, err := Parts(dir); err != nil {
			return result, err
		}
	}
	root, err := s.OpenDir(dir)
	if err != nil {
		return result, err
	}
	_ = root.Close()
	needle := strings.ToLower(query)
	entriesSeen := 0
	var visit func(string) error
	visit = func(folder string) error {
		if err := ctx.Err(); err != nil {
			return err
		}
		f, err := s.OpenDir(folder)
		if err != nil {
			if folder == dir {
				return err
			}
			return nil // A directory may have disappeared during the scan.
		}
		remainingEntries := MaxSearchEntries - entriesSeen
		if remainingEntries <= 0 {
			_ = f.Close()
			result.Limit = "entries"
			return nil
		}
		entries, err := f.ReadDir(remainingEntries + 1)
		_ = f.Close()
		if err != nil && !errors.Is(err, io.EOF) {
			return err
		}
		truncated := len(entries) > remainingEntries
		if truncated {
			entries = entries[:remainingEntries]
		}
		entriesSeen += len(entries)
		for _, entry := range entries {
			if err := ctx.Err(); err != nil {
				return err
			}
			if Excluded(entry.Name()) {
				continue
			}
			rel := path.Join(folder, entry.Name())
			info, err := s.root.Lstat(rel)
			if err != nil || info.Mode()&(fs.ModeSymlink|fs.ModeIrregular) != 0 {
				continue
			}
			if info.IsDir() {
				if err := visit(rel); err != nil {
					return err
				}
				if result.Limit != "" {
					return nil
				}
				continue
			}
			if !info.Mode().IsRegular() {
				continue
			}
			switch strings.ToLower(path.Ext(rel)) {
			case ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg":
				continue // These files open as images, without a source-line view.
			}
			if result.FilesScanned >= MaxSearchFiles {
				result.Limit = "files"
				return nil
			}
			result.FilesScanned++
			if info.Size() > MaxTextSize {
				continue
			}
			if info.Size() > MaxSearchBytes-result.BytesRead {
				result.Limit = "bytes"
				return nil
			}
			file, err := s.Open(rel)
			if err != nil {
				continue
			}
			current, err := file.Stat()
			if err != nil || !current.Mode().IsRegular() || current.Size() > MaxTextSize {
				_ = file.Close()
				continue
			}
			remaining := int64(MaxSearchBytes) - result.BytesRead
			if current.Size() > remaining {
				_ = file.Close()
				result.Limit = "bytes"
				return nil
			}
			data, err := readBounded(contextReader{ctx, file}, current.Size(), min(remaining, int64(MaxTextSize)))
			_ = file.Close()
			if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
				return err
			}
			if errors.Is(err, ErrTooLarge) {
				result.Limit = "bytes"
				return nil
			}
			if err != nil {
				continue
			}
			result.BytesRead += int64(len(data))
			if !utf8.Valid(data) || strings.IndexFunc(string(data), func(r rune) bool { return r < 0x20 && r != '\n' && r != '\r' && r != '\t' && r != '\f' }) >= 0 {
				continue
			}
			lines := strings.Split(string(data), "\n")
			for i, line := range lines {
				if err := ctx.Err(); err != nil {
					return err
				}
				index := strings.Index(strings.ToLower(line), needle)
				if index < 0 {
					continue
				}
				// Case folding may change byte lengths for some Unicode letters.
				// In that case keep the full line rather than slicing at a wrong offset.
				text := contextLine(line)
				if len(strings.ToLower(line)) == len(line) {
					text = searchSnippet(line, index, min(index+len(query), len(line)))
				}
				match := ContentMatch{Path: rel, Line: i + 1, Text: text}
				if i > 0 {
					match.Before = contextLine(lines[i-1])
				}
				if i+1 < len(lines) {
					match.After = contextLine(lines[i+1])
				}
				result.Matches = append(result.Matches, match)
				if len(result.Matches) >= MaxSearchMatches {
					result.Limit = "matches"
					return nil
				}
			}
		}
		if truncated {
			result.Limit = "entries"
		}
		return nil
	}
	return result, visit(dir)
}
