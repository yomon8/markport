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
	return m.findWord(line, false)
}

func (m literalMatcher) findWord(line string, wholeWord bool) (int, int, bool) {
	text := line
	if !m.caseSensitive {
		text = strings.ToLower(line)
	}
	// Lower once per line, including when many candidate matches fail word
	// boundaries. Two monotonic cursors map overlapping matches back to UTF-8.
	needsMapping := !m.caseSensitive && utf8.RuneCountInString(line) != len(line)
	mapOffset := func(target int, original, folded *int) int {
		if !needsMapping {
			return target
		}
		for *folded < target && *original < len(line) {
			r, size := utf8.DecodeRuneInString(line[*original:])
			*original += size
			*folded += utf8.RuneLen(unicode.ToLower(r))
		}
		return *original
	}
	originalStart, foldedStart, originalEnd, foldedEnd := 0, 0, 0, 0
	for offset := 0; offset <= len(text); {
		index := strings.Index(text[offset:], m.needle)
		if index < 0 {
			break
		}
		index += offset
		start := mapOffset(index, &originalStart, &foldedStart)
		end := mapOffset(index+len(m.needle), &originalEnd, &foldedEnd)
		if !wholeWord || wordBoundaries(line, start, end) {
			return start, end, true
		}
		if index == len(text) {
			break
		}
		_, size := utf8.DecodeRuneInString(text[index:])
		offset = index + size
	}
	return 0, 0, false
}

type queryMatcher struct {
	literal     literalMatcher
	pattern     *regexp.Regexp
	wordPattern *regexp.Regexp
	word        bool
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
		if m.word {
			// Select valid boundaries without discarding overlapping matches
			// inside an earlier rejected match. Keep anchors on the full line.
			m.wordPattern, err = regexp.Compile(`(?:^|[^\p{L}\p{Nd}_])(` + pattern + `)(?:$|[^\p{L}\p{Nd}_])`)
			if err != nil {
				return nil, fmt.Errorf("%w: %v", ErrQuery, err)
			}
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
			if found := m.wordPattern.FindStringSubmatchIndex(line); found != nil && wordBoundaries(line, found[2], found[3]) {
				return found[2], found[3], true
			}
		}
		return 0, 0, false
	}
	return m.literal.findWord(line, m.word)
}
