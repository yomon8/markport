package files

import (
	"errors"
	"fmt"
	"regexp"
	"strings"
	"unicode"
	"unicode/utf8"
)

// matcher returns byte offsets in the original source line.
type matcher interface {
	find(line string) (start, end int, ok bool)
}

var ErrQuery = errors.New("invalid query")

type literalMatcher struct {
	needle        string
	caseSensitive bool
}

func (m literalMatcher) find(line string) (int, int, bool) {
	if m.caseSensitive {
		start := strings.Index(line, m.needle)
		return start, start + len(m.needle), start >= 0
	}
	lowered := strings.ToLower(line)
	start := strings.Index(lowered, m.needle)
	if start < 0 {
		return 0, 0, false
	}
	end := start + len(m.needle)
	if utf8.RuneCountInString(line) == len(line) {
		return start, end, true
	}
	// Lowercasing can change UTF-8 widths (for example, İ becomes i).
	// Map folded offsets back before building snippets from the source.
	folded := 0
	originalStart, originalEnd := len(line), len(line)
	for offset, r := range line {
		if folded == start {
			originalStart = offset
		}
		if folded == end {
			originalEnd = offset
			break
		}
		folded += utf8.RuneLen(unicode.ToLower(r))
	}
	return originalStart, originalEnd, true
}

type queryMatcher struct {
	literal literalMatcher
	pattern *regexp.Regexp
	word    bool
}

func newMatcher(opts SearchOptions) (matcher, error) {
	m := queryMatcher{word: opts.WholeWord}
	if opts.Regex {
		pattern := opts.Query
		if !opts.CaseSensitive {
			pattern = "(?i)" + pattern
		}
		var err error
		m.pattern, err = regexp.Compile(pattern)
		if err != nil {
			return nil, fmt.Errorf("%w: %v", ErrQuery, err)
		}
	} else {
		needle := opts.Query
		if !opts.CaseSensitive {
			needle = strings.ToLower(needle)
		}
		m.literal = literalMatcher{needle: needle, caseSensitive: opts.CaseSensitive}
	}
	return m, nil
}

func wordRune(r rune) bool { return unicode.IsLetter(r) || unicode.IsDigit(r) || r == '_' }

func wordBoundaries(line string, start, end int) bool {
	if start > 0 {
		r, _ := utf8.DecodeLastRuneInString(line[:start])
		if wordRune(r) {
			return false
		}
	}
	if end < len(line) {
		r, _ := utf8.DecodeRuneInString(line[end:])
		if wordRune(r) {
			return false
		}
	}
	return true
}

func (m queryMatcher) find(line string) (int, int, bool) {
	if m.pattern != nil {
		if !m.word {
			if found := m.pattern.FindStringIndex(line); found != nil {
				return found[0], found[1], true
			}
		} else {
			// Search the original line so anchors retain their RE2 meaning.
			for _, found := range m.pattern.FindAllStringIndex(line, -1) {
				if wordBoundaries(line, found[0], found[1]) {
					return found[0], found[1], true
				}
			}
		}
		return 0, 0, false
	}
	for offset := 0; offset <= len(line); {
		start, end, ok := m.literal.find(line[offset:])
		if !ok {
			return 0, 0, false
		}
		start += offset
		end += offset
		if !m.word || wordBoundaries(line, start, end) {
			return start, end, true
		}
		if start == len(line) {
			break
		}
		_, size := utf8.DecodeRuneInString(line[start:])
		offset = start + size
	}
	return 0, 0, false
}
