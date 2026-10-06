package render

import (
	"html"
	"regexp"
	"strings"
	"testing"
)

func TestTableSource(t *testing.T) {
	for _, table := range []string{
		"| A | B |\n| :--- | ---: |\n| **bold** | [link](other.md) |\n",
		"A | B\n--- | ---\n | \n",
		"| A | B |\n|---|---|\n| a\\|b | `x\\|y` |\n| $x_1$ | <script>\"&</script> |\n",
		"| A |\r\n|---|\r\n| 1 |\r\n",
		"| A |\n|---|",
		"| | |\n|-|-|\n|||\n",
	} {
		t.Run(table, func(t *testing.T) {
			for _, render := range []func(string) (string, error){func(input string) (string, error) { return Markdown("a.md", input) }, PastedMarkdown} {
				out, err := render("Before\n\n" + table + "\n\nAfter\n")
				if err != nil {
					t.Fatal(err)
				}
				values := tableSources(out)
				if len(values) != 1 || strings.TrimRight(values[0], "\r\n") != strings.TrimRight(table, "\r\n") {
					t.Fatalf("source mismatch: %q\n%s", values, out)
				}
				if strings.Contains(out, "<script>") {
					t.Fatalf("unescaped source: %s", out)
				}
			}
		})
	}
}

func TestTableSourceContainersAndMultipleTables(t *testing.T) {
	table := "| A | B |\n|---|---|\n| 1 | 2 |\n"
	for _, input := range []string{
		"> " + strings.ReplaceAll(strings.TrimSuffix(table, "\n"), "\n", "\n> ") + "\n",
		"- item\n\n  " + strings.ReplaceAll(strings.TrimSuffix(table, "\n"), "\n", "\n  ") + "\n",
		"- item\n\n  > " + strings.ReplaceAll(strings.TrimSuffix(table, "\n"), "\n", "\n  > ") + "\n",
		table + "\nBetween\n\n" + table,
		"Before\n" + table,
	} {
		out := mustMarkdown(t, input)
		values := tableSources(out)
		if len(values) != strings.Count(input, "|---|---|") {
			t.Fatalf("missing sources: %q\n%s", values, out)
		}
		for _, value := range values {
			if strings.TrimRight(value, "\r\n") != strings.TrimRight(table, "\r\n") {
				t.Fatalf("container or neighboring text copied: %q", value)
			}
		}
	}
}

func TestTableSourceWithoutLeadingPipesAfterParagraphText(t *testing.T) {
	table := "A | B\n--- | ---\n1 | 2\n"
	values := tableSources(mustMarkdown(t, "Before\n"+table))
	if len(values) != 1 || values[0] != table {
		t.Fatalf("unexpected table source: %q", values)
	}
}

func tableSources(out string) []string {
	var values []string
	for _, match := range regexp.MustCompile(`data-table-source="([^"]*)"`).FindAllStringSubmatch(out, -1) {
		values = append(values, html.UnescapeString(match[1]))
	}
	return values
}
