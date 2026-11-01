package files

import (
	"errors"
	"strings"
	"testing"
)

func TestLiteralMatcherSourceOffsets(t *testing.T) {
	for _, tc := range []struct {
		line, query, want string
	}{
		{"before NEEDLE after", "needle", "NEEDLE"},
		{"İ before NEEDLE", "needle", "NEEDLE"},
		{"İȺ needle", "ⱥ", "Ⱥ"},
		{"日本語の検索", "検索", "検索"},
		{"İ", "i", "İ"},
	} {
		t.Run(tc.line+"/"+tc.query, func(t *testing.T) {
			m := literalMatcher{needle: strings.ToLower(tc.query)}
			start, end, ok := m.find(tc.line)
			if !ok || tc.line[start:end] != tc.want {
				t.Fatalf("find = %d, %d, %v; want %q", start, end, ok, tc.want)
			}
		})
	}
	if _, _, ok := (literalMatcher{needle: "absent"}).find("example"); ok {
		t.Fatal("matched absent query")
	}
}

func TestSearchMatchers(t *testing.T) {
	for _, tc := range []struct {
		name, line, want string
		opts             SearchOptions
		found            bool
	}{
		{"case default", "Cat", "Cat", SearchOptions{Query: "cat"}, true},
		{"case exact", "Cat cat", "cat", SearchOptions{Query: "cat", CaseSensitive: true}, true},
		{"case mismatch", "Cat", "", SearchOptions{Query: "cat", CaseSensitive: true}, false},
		{"ascii words", "scatter cat", "cat", SearchOptions{Query: "cat", WholeWord: true}, true},
		{"underscore", "_cat cat_ cat", "cat", SearchOptions{Query: "cat", WholeWord: true}, true},
		{"digits", "cat2 2cat", "", SearchOptions{Query: "cat", WholeWord: true}, false},
		{"Japanese boundary", "日本語 日本", "日本", SearchOptions{Query: "日本", WholeWord: true}, true},
		{"Unicode prefix", "İcat cat", "cat", SearchOptions{Query: "cat", WholeWord: true}, true},
		{"groups", "BUG-123", "BUG-123", SearchOptions{Query: `(bug|fix)-\d+`, Regex: true}, true},
		{"regex case", "BUG-123", "", SearchOptions{Query: `bug-\d+`, Regex: true, CaseSensitive: true}, false},
		{"explicit flag", "BUG-123", "BUG-123", SearchOptions{Query: `(?i)bug-\d+`, Regex: true, CaseSensitive: true}, true},
		{"regex words", "scatter cat", "cat", SearchOptions{Query: `cat`, Regex: true, WholeWord: true}, true},
		{"anchored words", "cats cat", "", SearchOptions{Query: `^cat`, Regex: true, WholeWord: true}, false},
		{"overlapping words", "za cat a", "cat", SearchOptions{Query: `a.*a|cat`, Regex: true, WholeWord: true}, true},
		{"Japanese regex words", "日本語 日本", "日本", SearchOptions{Query: `日本`, Regex: true, WholeWord: true}, true},
		{"empty regex word", "abc", "", SearchOptions{Query: `$`, Regex: true, WholeWord: true}, false},
		{"empty regex match", "abc", "", SearchOptions{Query: `$`, Regex: true}, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			m, err := newMatcher(tc.opts)
			if err != nil {
				t.Fatal(err)
			}
			start, end, ok := m.find(tc.line)
			if ok != tc.found || ok && tc.line[start:end] != tc.want {
				t.Fatalf("find = %d, %d, %v; want %q, %v", start, end, ok, tc.want, tc.found)
			}
			if tc.name == "underscore" && start != 10 {
				t.Fatalf("matched inside identifier: %d", start)
			}
		})
	}
	if _, err := newMatcher(SearchOptions{Query: "[", Regex: true}); !errors.Is(err, ErrQuery) {
		t.Fatalf("invalid regexp: %v", err)
	}
}

func TestWholeWordDenseCandidates(t *testing.T) {
	for _, prefix := range []string{strings.Repeat("a", 20000), strings.Repeat("İ", 20000)} {
		query := "a"
		if strings.HasPrefix(prefix, "İ") {
			query = "i"
		}
		m, err := newMatcher(SearchOptions{Query: query, WholeWord: true})
		if err != nil {
			t.Fatal(err)
		}
		line := prefix + " " + query
		start, end, ok := m.find(line)
		if !ok || start != len(prefix)+1 || end != len(line) {
			t.Fatalf("dense word matches: %d, %d, %v", start, end, ok)
		}
	}
}
