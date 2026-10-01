package render

import (
	"bytes"
	"html"
	"strings"

	"github.com/yuin/goldmark/ast"
	"github.com/yuin/goldmark/parser"
	"github.com/yuin/goldmark/renderer"
	"github.com/yuin/goldmark/text"
	"github.com/yuin/goldmark/util"
)

var kindMath = ast.NewNodeKind("Math")
var kindMathBlock = ast.NewNodeKind("MathBlock")

var missingMathClosersKey = parser.NewContextKey()

type mathSearch struct {
	parent ast.Node
	close  string
	block  bool
}

// Remember unsuccessful scans so repeated openers cannot cause quadratic work.
func missingMathClosers(pc parser.Context) map[mathSearch]int {
	return pc.ComputeIfAbsent(missingMathClosersKey, func() interface{} { return map[mathSearch]int{} }).(map[mathSearch]int)
}

type mathInline struct {
	ast.BaseInline
	source  string
	display bool
}

func (n *mathInline) Kind() ast.NodeKind            { return kindMath }
func (n *mathInline) Text([]byte) []byte            { return []byte(n.source) }
func (n *mathInline) Dump(source []byte, level int) { ast.DumpHelper(n, source, level, nil, nil) }

type mathBlock struct {
	ast.BaseBlock
	source     string
	closingEnd int
}

func (n *mathBlock) Kind() ast.NodeKind            { return kindMathBlock }
func (n *mathBlock) IsRaw() bool                   { return true }
func (n *mathBlock) Dump(source []byte, level int) { ast.DumpHelper(n, source, level, nil, nil) }

// Math is parsed before Markdown escapes or emphasis can alter its source.
type mathInlineParser struct{}

func (mathInlineParser) Trigger() []byte { return []byte{'$', '\\'} }
func (mathInlineParser) Parse(parent ast.Node, reader text.Reader, pc parser.Context) ast.Node {
	line, segment := reader.PeekLine()
	open, close, display := mathDelimiters(line)
	if open == "" {
		return nil
	}
	if open == "$" && (len(line) <= 1 || util.IsSpace(line[1])) {
		return nil
	}
	key := mathSearch{parent: parent, close: close}
	missing := missingMathClosers(pc)
	if missing[key] > segment.Start {
		return nil
	}
	for i := len(open); i+len(close) <= len(line); i++ {
		if line[i] == '\n' || line[i] == '\r' {
			break
		}
		if !bytes.HasPrefix(line[i:], []byte(close)) || mathEscaped(line, i) {
			continue
		}
		if open == "$" && (util.IsSpace(line[i-1]) || (i+1 < len(line) && line[i+1] >= '0' && line[i+1] <= '9')) {
			continue
		}
		if i == len(open) {
			return nil
		}
		end := i + len(close)
		node := &mathInline{source: string(line[:end]), display: display}
		reader.Advance(end)
		return node
	}
	missing[key] = segment.Stop
	return nil
}

func mathDelimiters(line []byte) (string, string, bool) {
	for _, pair := range [][2]string{{"$$", "$$"}, {`\[`, `\]`}, {`\(`, `\)`}, {"$", "$"}} {
		if bytes.HasPrefix(line, []byte(pair[0])) {
			return pair[0], pair[1], pair[0] == "$$" || pair[0] == `\[`
		}
	}
	return "", "", false
}

func mathEscaped(line []byte, at int) bool {
	count := 0
	for i := at - 1; i >= 0 && line[i] == '\\'; i-- {
		count++
	}
	return count%2 != 0
}

type mathBlockParser struct{}

func (mathBlockParser) Trigger() []byte                             { return []byte{'$', '\\'} }
func (mathBlockParser) CanInterruptParagraph() bool                 { return true }
func (mathBlockParser) CanAcceptIndentedLine() bool                 { return false }
func (mathBlockParser) Close(ast.Node, text.Reader, parser.Context) {}

func (mathBlockParser) Open(parent ast.Node, reader text.Reader, pc parser.Context) (ast.Node, parser.State) {
	line, segment := reader.PeekLine()
	pos := pc.BlockOffset()
	if pos < 0 {
		return nil, parser.NoChildren
	}
	line = bytes.TrimRight(line[pos:], "\r\n")
	open, close, display := mathDelimiters(line)
	if !display {
		return nil, parser.NoChildren
	}
	// A block delimiter must close at the end of its line.
	for i := len(open); i+len(close) <= len(line); i++ {
		if bytes.HasPrefix(line[i:], []byte(close)) && !mathEscaped(line, i) && strings.TrimSpace(string(line[i+len(close):])) == "" {
			reader.AdvanceToEOL()
			return &mathBlock{source: string(line[:i+len(close)]), closingEnd: segment.Stop}, parser.NoChildren
		}
	}
	// Look ahead within the current containers; an unclosed opener stays Markdown.
	key := mathSearch{parent: parent, close: close, block: true}
	missing := missingMathClosers(pc)
	if missing[key] > segment.Start {
		return nil, parser.NoChildren
	}
	var value strings.Builder
	value.Write(line)
	value.WriteByte('\n')
	source := reader.Source()
	for start := segment.Stop; start < len(source); {
		end := start + bytes.IndexByte(source[start:], '\n') + 1
		if end <= start {
			end = len(source)
		}
		content, ok := mathContainerLine(parent, source[start:end])
		if !ok {
			missing[key] = start
			break
		}
		trimmed := bytes.TrimSpace(content)
		if bytes.Equal(trimmed, []byte(close)) {
			value.WriteString(close)
			reader.AdvanceToEOL()
			return &mathBlock{source: value.String(), closingEnd: end}, parser.NoChildren
		}
		value.Write(content)
		start = end
		missing[key] = end
	}
	return nil, parser.NoChildren
}

// Strip only the surrounding quote/list prefixes, preserving the TeX itself.
func mathContainerLine(parent ast.Node, line []byte) ([]byte, bool) {
	var ancestors []ast.Node
	for n := parent; n != nil; n = n.Parent() {
		ancestors = append(ancestors, n)
	}
	offset := 0
	for i := len(ancestors) - 1; i >= 0; i-- {
		switch n := ancestors[i].(type) {
		case *ast.Blockquote:
			spaces := 0
			for spaces < len(line) && spaces < 3 && line[spaces] == ' ' {
				spaces++
			}
			if spaces >= len(line) || line[spaces] != '>' {
				return nil, false
			}
			line = line[spaces+1:]
			offset += spaces + 1
			if len(line) > 0 && line[0] == ' ' {
				line = line[1:]
				offset++
			}
		case *ast.ListItem:
			if util.IsBlank(line) {
				continue
			}
			pos, padding := util.IndentPosition(line, offset, n.Offset)
			if pos < 0 {
				return nil, false
			}
			line = append(bytes.Repeat([]byte{' '}, padding), line[pos:]...)
			offset += n.Offset
		}
	}
	return line, true
}

func (mathBlockParser) Continue(node ast.Node, reader text.Reader, _ parser.Context) parser.State {
	_, segment := reader.PeekLine()
	if segment.Start >= node.(*mathBlock).closingEnd {
		return parser.Close
	}
	reader.AdvanceToEOL()
	if segment.Stop >= node.(*mathBlock).closingEnd {
		return parser.Close
	}
	return parser.Continue | parser.NoChildren
}

type mathRenderer struct{}

func (mathRenderer) RegisterFuncs(r renderer.NodeRendererFuncRegisterer) {
	r.Register(kindMath, renderMath)
	r.Register(kindMathBlock, renderMath)
}
func renderMath(w util.BufWriter, _ []byte, node ast.Node, entering bool) (ast.WalkStatus, error) {
	if !entering {
		return ast.WalkContinue, nil
	}
	tag, mode, value := "span", "inline", ""
	switch n := node.(type) {
	case *mathInline:
		value = n.source
		if n.display {
			mode = "display"
		}
	case *mathBlock:
		tag, mode, value = "div", "display", n.source
	}
	_, err := w.WriteString(`<` + tag + ` class="math-source" data-math="` + mode + `">` + html.EscapeString(value) + `</` + tag + `>`)
	return ast.WalkContinue, err
}
