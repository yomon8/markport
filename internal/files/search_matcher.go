package files

import (
	"strings"
	"unicode"
	"unicode/utf8"
)

// matcher returns byte offsets in the original source line.
type matcher interface {
	find(line string) (start, end int, ok bool)
}

type literalMatcher struct{ needle string }

func (m literalMatcher) find(line string) (int, int, bool) {
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
