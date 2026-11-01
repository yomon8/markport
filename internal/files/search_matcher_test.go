package files

import (
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
