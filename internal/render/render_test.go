package render

import (
	"strings"
	"testing"
)

func TestMarkdown(t *testing.T) {
	input := "# Hello World\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n- [x] done\n\n[local](../other.md#part) [external](https://example.com) ![image](image.png) [bad](javascript:alert(1))\n\n<script>alert(1)</script>\n\n```mermaid\ngraph TD; A-->B\n```\n\n```python\nprint('ok')\n```\n"
	out, err := Markdown("docs/readme.md", input)
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"<table>", "checkbox", "id=\"hello-world\"", "/?path=other.md#part", "/api/asset?path=docs%2Fimage.png", "https://example.com", "data-mermaid=\"true\"", "graph TD; A--&gt;B", "print"} {
		if !strings.Contains(out, want) {
			t.Errorf("missing %q in %s", want, out)
		}
	}
	for _, bad := range []string{"<script>", "javascript:alert"} {
		if strings.Contains(out, bad) {
			t.Errorf("unsafe %q in %s", bad, out)
		}
	}
}
func TestCodeEscapes(t *testing.T) {
	for _, name := range []string{"file.unknown", "file.py"} {
		out := Code(name, "<script>alert(1)</script>")
		if strings.Contains(out, "<script>") {
			t.Fatalf("raw script in %s: %s", name, out)
		}
	}
}
