package files

import (
	"bytes"
	"context"
	"errors"
	"io"
	"io/fs"
	"path"
	"sort"
	"strings"
	"unicode"
	"unicode/utf8"
)

const (
	MaxSearchFiles   = 2000
	MaxSearchEntries = 10000
	MaxSearchBytes   = 64 << 20
	MaxSearchMatches = 100
)

type ContentMatch struct {
	Path       string `json:"path"`
	Line       int    `json:"line"`
	Before     string `json:"before"`
	Text       string `json:"text"`
	After      string `json:"after"`
	MatchStart int    `json:"matchStart,omitempty"`
	MatchEnd   int    `json:"matchEnd,omitempty"`
}

type ContentSearch struct {
	Matches        []ContentMatch `json:"matches"`
	FilesScanned   int            `json:"filesScanned"`
	BytesRead      int64          `json:"bytesRead"`
	Limit          string         `json:"limit,omitempty"`
	IgnoredSkipped int            `json:"ignoredSkipped"`
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

func searchSnippet(line string, start, end int) (string, int, int) {
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
	combined := string(left) + string(middle) + string(right)
	trimmedLeft := strings.TrimLeftFunc(combined, unicode.IsSpace)
	leadingTrimmed := utf8.RuneCountInString(combined) - utf8.RuneCountInString(trimmedLeft)
	text := strings.TrimRightFunc(trimmedLeft, unicode.IsSpace)
	textRunes := utf8.RuneCountInString(text)
	matchStart := max(0, len(left)-leadingTrimmed)
	matchEnd := min(textRunes, max(matchStart, len(left)+len(middle)-leadingTrimmed))
	return text, matchStart, matchEnd
}

func hasDisallowedControlByte(data []byte) bool {
	for _, b := range data {
		if b < 0x20 && b != '\n' && b != '\r' && b != '\t' && b != '\f' {
			return true
		}
	}
	return false
}

// isTextProbe validates a leading file chunk without misclassifying a valid
// multi-byte UTF-8 rune split across the probe boundary.
func isTextProbe(probe []byte, eof bool) bool {
	if hasDisallowedControlByte(probe) {
		return false
	}
	check := probe
	if !eof && len(check) > 0 {
		start := len(check) - 1
		for start > 0 && len(check)-start < utf8.UTFMax && !utf8.RuneStart(check[start]) {
			start--
		}
		if utf8.RuneStart(check[start]) && !utf8.FullRune(check[start:]) {
			check = check[:start]
		}
	}
	return utf8.Valid(check)
}

func readTextForSearch(ctx context.Context, file io.Reader, size, maxRemaining int64) ([]byte, bool, error) {
	const probeSize = 8192
	var probeBuf [probeSize]byte
	n, err := io.ReadFull(contextReader{ctx, file}, probeBuf[:])
	eof := errors.Is(err, io.EOF) || errors.Is(err, io.ErrUnexpectedEOF)
	if err != nil && !eof {
		return nil, false, err
	}
	probe := probeBuf[:n]
	if !isTextProbe(probe, eof) {
		return nil, true, nil
	}
	if eof {
		if int64(len(probe)) > maxRemaining {
			return nil, false, ErrTooLarge
		}
		return probe, false, nil
	}
	if size > maxRemaining {
		return nil, false, ErrTooLarge
	}
	restLimit := maxRemaining - int64(len(probe))
	rest, err := readBounded(contextReader{ctx, file}, max(0, size-int64(len(probe))), restLimit)
	if err != nil {
		return nil, false, err
	}
	data := make([]byte, len(probe)+len(rest))
	copy(data, probe)
	copy(data[len(probe):], rest)
	if !utf8.Valid(data) || hasDisallowedControlByte(data) {
		return nil, true, nil
	}
	return data, false, nil
}
func contextLine(line string) string {
	line = strings.TrimSpace(line)
	runes := []rune(line)
	if len(runes) > 160 {
		return string(runes[:160]) + "…"
	}
	return line
}

type SearchOptions struct {
	Folder        string
	Query         string
	CaseSensitive bool
	WholeWord     bool
	Regex         bool
	Include       []string
	Candidates    []string
	Deferred      []string
	Exclude       []string
}

// SearchContent preserves the original API for callers without search options.
func (s *Store) SearchContent(ctx context.Context, dir, query string) (ContentSearch, error) {
	return s.Search(ctx, SearchOptions{Folder: dir, Query: query})
}

// Search scans the requested directory. Every open stays inside Store's root,
// including when entries change during a scan.
func (s *Store) Search(ctx context.Context, opts SearchOptions) (ContentSearch, error) {
	dir, query := opts.Folder, opts.Query
	result := ContentSearch{Matches: []ContentMatch{}}
	query = strings.TrimSpace(query)
	if query == "" || utf8.RuneCountInString(query) > 200 {
		return result, ErrPath
	}
	opts.Query = query
	matchLine, err := newMatcher(opts)
	if err != nil {
		return result, err
	}
	include, err := normalizePatterns(opts.Include)
	if err != nil {
		return result, err
	}
	exclude, err := normalizePatterns(opts.Exclude)
	if err != nil {
		return result, err
	}
	if err := ctx.Err(); err != nil {
		return result, err
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
	if opts.CaseSensitive {
		needle = query
	}
	needleBytes := []byte(needle)
	scan := func(rel string) error {
		if err := ctx.Err(); err != nil {
			return err
		}
		if _, err := Parts(rel); err != nil {
			return nil
		}
		if dir != "" && !strings.HasPrefix(rel, dir+"/") {
			return nil
		}
		info, err := s.root.Lstat(rel)
		if err != nil || info.Mode()&(fs.ModeSymlink|fs.ModeIrregular) != 0 {
			return nil
		}
		if !info.Mode().IsRegular() {
			return nil
		}
		if !searchPathIncluded(rel, include, exclude) {
			return nil
		}
		switch strings.ToLower(path.Ext(rel)) {
		case ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".pdf":
			return nil // These files open as images or PDFs, without a source-line view.
		}
		if result.FilesScanned >= MaxSearchFiles {
			result.Limit = "files"
			return nil
		}
		result.FilesScanned++
		if info.Size() > MaxTextSize {
			return nil
		}
		file, err := s.Open(rel)
		if err != nil {
			return nil
		}
		current, err := file.Stat()
		if err != nil || !current.Mode().IsRegular() || current.Size() > MaxTextSize {
			_ = file.Close()
			return nil
		}
		remaining := int64(MaxSearchBytes) - result.BytesRead
		data, binary, err := readTextForSearch(ctx, file, current.Size(), min(remaining, int64(MaxTextSize)))
		_ = file.Close()
		if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
			return err
		}
		if errors.Is(err, ErrTooLarge) {
			result.Limit = "bytes"
			return nil
		}
		if err != nil || binary {
			return nil
		}
		result.BytesRead += int64(len(data))
		// Fold the file only as a filter: Unicode folding may change byte
		// offsets, so line numbers and snippets always use the original data.
		if !opts.Regex {
			filtered := data
			if !opts.CaseSensitive {
				filtered = bytes.ToLower(data)
			}
			if strings.ContainsRune(needle, '\n') || !bytes.Contains(filtered, needleBytes) {
				return nil
			}
		}
		previousStart, previousEnd := 0, 0
		for start, number := 0, 1; start <= len(data); number++ {
			if err := ctx.Err(); err != nil {
				return err
			}
			end := len(data)
			if newline := bytes.IndexByte(data[start:], '\n'); newline >= 0 {
				end = start + newline
			}
			line := string(data[start:end])
			if index, matchEnd, ok := matchLine.find(line); ok {
				text, spanStart, spanEnd := searchSnippet(line, index, matchEnd)
				// Preserve the original snippet policy for width-changing folds.
				if !opts.Regex && !opts.CaseSensitive && !opts.WholeWord && len(strings.ToLower(line)) != len(line) {
					text = contextLine(line)
					spanStart, spanEnd = 0, 0
				}
				match := ContentMatch{Path: rel, Line: number, Text: text, MatchStart: spanStart, MatchEnd: spanEnd}
				if number > 1 {
					match.Before = contextLine(string(data[previousStart:previousEnd]))
				}
				if end < len(data) {
					nextStart, nextEnd := end+1, len(data)
					if newline := bytes.IndexByte(data[nextStart:], '\n'); newline >= 0 {
						nextEnd = nextStart + newline
					}
					match.After = contextLine(string(data[nextStart:nextEnd]))
				}
				result.Matches = append(result.Matches, match)
				if len(result.Matches) >= MaxSearchMatches {
					result.Limit = "matches"
					return nil
				}
			}
			previousStart, previousEnd = start, end
			start = end + 1
		}
		return nil
	}
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
		sort.Slice(entries, func(i, j int) bool { return entries[i].Name() < entries[j].Name() })
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
			if err := scan(rel); err != nil {
				return err
			}
			if result.Limit != "" {
				return nil
			}
		}
		if truncated {
			result.Limit = "entries"
		}
		return nil
	}
	if opts.Candidates != nil || opts.Deferred != nil {
		seen := make(map[string]bool)
		for _, group := range [][]string{opts.Candidates, opts.Deferred} {
			for _, rel := range group {
				if err := ctx.Err(); err != nil {
					return result, err
				}
				if seen[rel] || dir != "" && !strings.HasPrefix(rel, dir+"/") {
					continue
				}
				seen[rel] = true
				if entriesSeen >= MaxSearchEntries {
					result.Limit = "entries"
					return result, nil
				}
				entriesSeen++
				if err := scan(rel); err != nil {
					return result, err
				}
				if result.Limit != "" {
					return result, nil
				}
			}
		}
		return result, nil
	}
	return result, visit(dir)
}
