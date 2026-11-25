package render

import (
	"bytes"
	"html"
	"regexp"

	"github.com/yuin/goldmark/ast"
	"github.com/yuin/goldmark/parser"
	"github.com/yuin/goldmark/renderer"
	"github.com/yuin/goldmark/text"
	"github.com/yuin/goldmark/util"
)

var kindMarkdownAnchor = ast.NewNodeKind("MarkdownAnchor")

const anchorID = `[\p{L}\p{M}\p{N}_.:-]+`

var anchorLine = regexp.MustCompile(`(?i)^<a[ \t]+id[ \t]*=[ \t]*(?:"(` + anchorID + `)"|'(` + anchorID + `)')[ \t]*>[ \t]*</a[ \t]*>[ \t]*$`)

type markdownAnchor struct {
	ast.BaseBlock
	id string
}

func (n *markdownAnchor) Kind() ast.NodeKind { return kindMarkdownAnchor }
func (n *markdownAnchor) Dump(source []byte, level int) {
	ast.DumpHelper(n, source, level, map[string]string{"ID": n.id}, nil)
}

type anchorParser struct{}

func (anchorParser) Trigger() []byte                             { return []byte{'<'} }
func (anchorParser) CanInterruptParagraph() bool                 { return true }
func (anchorParser) CanAcceptIndentedLine() bool                 { return false }
func (anchorParser) Close(ast.Node, text.Reader, parser.Context) {}
func (anchorParser) Continue(ast.Node, text.Reader, parser.Context) parser.State {
	return parser.Close
}

func (anchorParser) Open(_ ast.Node, reader text.Reader, pc parser.Context) (ast.Node, parser.State) {
	line, _ := reader.PeekLine()
	offset := pc.BlockOffset()
	if offset < 0 {
		return nil, parser.NoChildren
	}
	match := anchorLine.FindSubmatch(bytes.TrimRight(line[offset:], "\r\n"))
	if match == nil {
		return nil, parser.NoChildren
	}
	id := match[1]
	if id == nil {
		id = match[2]
	}
	reader.AdvanceToEOL()
	return &markdownAnchor{id: string(id)}, parser.NoChildren
}

type anchorRenderer struct{}

func (anchorRenderer) RegisterFuncs(r renderer.NodeRendererFuncRegisterer) {
	r.Register(kindMarkdownAnchor, renderAnchor)
}

func renderAnchor(w util.BufWriter, _ []byte, n ast.Node, entering bool) (ast.WalkStatus, error) {
	if !entering {
		return ast.WalkContinue, nil
	}
	// Keep user-chosen IDs out of the application's global DOM ID namespace.
	_, err := w.WriteString(`<div data-markdown-anchor="` + html.EscapeString(n.(*markdownAnchor).id) + `"></div>` + "\n")
	return ast.WalkContinue, err
}
