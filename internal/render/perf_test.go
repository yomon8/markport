package render

import (
	"strings"
	"testing"
)

func BenchmarkMarkdown(b *testing.B) {
	content := strings.Repeat("A paragraph with **emphasis** and [a link](other.md). ", 96) + "\n\n```go\npackage main\nfunc main() {}\n```\n\n"
	content = strings.Repeat(content, 200)
	b.SetBytes(int64(len(content)))
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		if _, err := Markdown("docs/large.md", content); err != nil {
			b.Fatal(err)
		}
	}
}
func BenchmarkCode(b *testing.B) {
	content := "package main\n" + strings.Repeat("func example() { println(\"hello\") }\n", 3000)
	b.SetBytes(int64(len(content)))
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		Code("large.go", content)
	}
}
