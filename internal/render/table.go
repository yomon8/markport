package render

import (
	"strings"

	"github.com/yuin/goldmark/ast"
	"github.com/yuin/goldmark/extension"
	tableast "github.com/yuin/goldmark/extension/ast"
	"github.com/yuin/goldmark/parser"
	"github.com/yuin/goldmark/text"
)

// Capture paragraph segments before GFM discards table delimiters and spacing.
// Segments already exclude surrounding quote/list prefixes.
type tableSourceTransformer struct{}

func (tableSourceTransformer) Transform(node *ast.Paragraph, reader text.Reader, pc parser.Context) {
	parent := node.Parent()
	if parent == nil || node.Lines().Len() < 2 {
		return
	}
	lines := append([]text.Segment(nil), node.Lines().Sliced(0, node.Lines().Len())...)
	previous, next := node.PreviousSibling(), node.NextSibling()
	extension.NewTableParagraphTransformer().Transform(node, reader, pc)
	first := parent.FirstChild()
	if node.Parent() != nil {
		first = node.NextSibling()
	} else if previous != nil {
		first = previous.NextSibling()
	}
	for child := first; child != nil && child != next; child = child.NextSibling() {
		table, ok := child.(*tableast.Table)
		if !ok {
			continue
		}
		header := table.FirstChild()
		if header == nil || header.FirstChild() == nil || header.FirstChild().Lines().Len() == 0 {
			continue
		}
		start := header.FirstChild().Lines().At(0).Start
		for index, line := range lines {
			if start < line.Start || start >= line.Stop {
				continue
			}
			// Header + delimiter + each body row.
			end := index + table.ChildCount() + 1
			if end > len(lines) {
				break
			}
			var source strings.Builder
			for _, segment := range lines[index:end] {
				source.Write(segment.Value(reader.Source()))
			}
			table.SetAttributeString("data-table-source", source.String())
			break
		}
	}
}
