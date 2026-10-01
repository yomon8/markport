package render

import (
	"strings"
	"testing"
)

func TestMath(t *testing.T) {
	for _, input := range []string{
		`$x_1 * y < z$`, `\(x_1 * y < z\)`, `$$\frac{1}{2}$$`, `\[\frac{1}{2}\]`,
		"$$\nx_1 < x_2\n\n+ y\n$$\n", "\\[\nx_1\n\\]\n",
		"# Heading $x_1$\n", "- $x_1$\n", "> $x_1$\n",
		"> $$\n> x_1\n> $$\n", "- $$\n  x_1\n  $$\n",
		"- outer\n  > $$\n  > x_1\n  > $$\n",
		"| A |\n|---|\n| $x_1$ |\n", "Before $$x_1$$ after", "$$x$$\n\nAfter\n",
	} {
		t.Run(input, func(t *testing.T) {
			for _, render := range []func(string) (string, error){func(input string) (string, error) { return Markdown("a.md", input) }, PastedMarkdown} {
				out, err := render(input)
				if err != nil || strings.Count(out, `data-math=`) != 1 {
					t.Fatalf("math not parsed: %v %s", err, out)
				}
				if strings.Contains(out, "<em>") || strings.Contains(out, "<script>") {
					t.Fatalf("Markdown parsed inside math: %s", out)
				}
				if strings.Contains(input, "After") && !strings.Contains(out, "After") {
					t.Fatalf("following paragraph lost: %s", out)
				}
			}
		})
	}
}

func TestMathExcluded(t *testing.T) {
	for _, input := range []string{
		`\$x\$`, `$5 and $10`, `$ x $`, `$x $`, `$ x$`, `$x$2`, `$unfinished`, `\(unfinished`,
		"`$x$`", "```latex\n$$x$$\n```", "    $$x$$\n", "```mermaid\n$x$\n```",
		`[link](https://example.com/$x$)`, "$$\nunfinished\n\n# Following\n",
		"> $$\n> unfinished\n\n$$\n", "- $$\n  unfinished\n\n$$\n",
	} {
		out := mustMarkdown(t, input)
		if strings.Contains(out, "data-math=") {
			t.Errorf("unexpected math for %q: %s", input, out)
		}
		if strings.Contains(input, "Following") && !strings.Contains(out, "<h1") {
			t.Errorf("following heading lost: %s", out)
		}
	}
}

func TestMathSourcePreserved(t *testing.T) {
	input := `$x_1 * y & <script>alert("x")</script> + \$ + \\z$`
	out := mustMarkdown(t, input)
	if !strings.Contains(out, `data-math="inline"`) || !strings.Contains(out, `x_1 * y &amp; &lt;script&gt;`) || !strings.Contains(out, `\$ + \\z`) {
		t.Fatal(out)
	}
}
