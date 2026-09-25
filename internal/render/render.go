package render

import (
	"bytes"
	"fmt"
	"html"
	"net/url"
	"path"
	"strings"

	"github.com/alecthomas/chroma/v2"
	chromahtml "github.com/alecthomas/chroma/v2/formatters/html"
	"github.com/alecthomas/chroma/v2/lexers"
	"github.com/alecthomas/chroma/v2/styles"
	"github.com/yuin/goldmark"
	"github.com/yuin/goldmark/ast"
	"github.com/yuin/goldmark/extension"
	"github.com/yuin/goldmark/parser"
	"github.com/yuin/goldmark/renderer"
	"github.com/yuin/goldmark/text"
	"github.com/yuin/goldmark/util"
)

func Code(filename, content string) string {
	lexer := lexers.Match(filename)
	if lexer == nil {
		lexer = lexers.Fallback
	}
	return highlight(content, lexer, true)
}

func highlight(content string, lexer chroma.Lexer, lineNumbers bool) string {
	fallback := "<pre><code>" + html.EscapeString(content) + "</code></pre>"
	if lexer == nil {
		return fallback
	}
	iterator, err := lexer.Tokenise(nil, content)
	if err != nil {
		return fallback
	}
	formatter := chromahtml.New(chromahtml.WithClasses(true), chromahtml.WithLineNumbers(lineNumbers), chromahtml.LineNumbersInTable(lineNumbers), chromahtml.WithLinkableLineNumbers(lineNumbers, "L"))
	var out bytes.Buffer
	if err := formatter.Format(&out, styles.Get("github"), iterator); err != nil {
		return fallback
	}
	return out.String()
}

type codeRenderer struct{}

func (codeRenderer) RegisterFuncs(r renderer.NodeRendererFuncRegisterer) {
	r.Register(ast.KindFencedCodeBlock, renderFence)
	r.Register(ast.KindCodeBlock, renderFence)
}
func renderFence(w util.BufWriter, source []byte, n ast.Node, entering bool) (ast.WalkStatus, error) {
	if !entering {
		return ast.WalkContinue, nil
	}
	var b strings.Builder
	for i := 0; i < n.Lines().Len(); i++ {
		segment := n.Lines().At(i)
		b.Write(segment.Value(source))
	}
	lang := ""
	if f, ok := n.(*ast.FencedCodeBlock); ok {
		lang = strings.TrimSpace(string(f.Language(source)))
	}
	var output string
	if strings.EqualFold(lang, "mermaid") {
		output = `<div class="mermaid-source" data-mermaid="true"><pre><code>` + html.EscapeString(b.String()) + `</code></pre></div>`
	} else {
		lexer := lexers.Get(lang)
		if lexer == nil {
			output = "<pre><code>" + html.EscapeString(b.String()) + "</code></pre>"
		} else {
			output = highlight(b.String(), lexer, false)
		}
		output = `<div data-language="` + html.EscapeString(lang) + `">` + output + `</div>`
	}
	_, err := w.WriteString(output)
	return ast.WalkContinue, err
}

func Markdown(filename, content string) (string, error) {
	return markdown(filename, content, false)
}

// PastedMarkdown renders text without resolving links against the browsed directory.
func PastedMarkdown(content string) (string, error) {
	return markdown("", content, true)
}

func markdown(filename, content string, pasted bool) (string, error) {
	source := []byte(content)
	md := goldmark.New(
		goldmark.WithExtensions(extension.GFM),
		goldmark.WithParserOptions(parser.WithAutoHeadingID()),
		goldmark.WithRendererOptions(renderer.WithNodeRenderers(util.Prioritized(codeRenderer{}, 100))),
	)
	doc := md.Parser().Parse(text.NewReader(source))
	var unresolved []ast.Node
	ast.Walk(doc, func(n ast.Node, entering bool) (ast.WalkStatus, error) {
		if !entering {
			return ast.WalkContinue, nil
		}
		switch v := n.(type) {
		case *ast.Link:
			if pasted && !pastedDestination(string(v.Destination), false) {
				unresolved = append(unresolved, n)
				break
			}
			v.Destination = rewrite(filename, string(v.Destination), false)
		case *ast.Image:
			if pasted && !pastedDestination(string(v.Destination), true) {
				unresolved = append(unresolved, n)
				break
			}
			v.Destination = rewrite(filename, string(v.Destination), true)
		case *ast.AutoLink:
			// Goldmark applies its own URL safety filter when rendering.
		}
		return ast.WalkContinue, nil
	})
	for i := len(unresolved) - 1; i >= 0; i-- {
		n := unresolved[i]
		if parent := n.Parent(); parent != nil {
			parent.ReplaceChild(parent, n, ast.NewString(n.Text(source)))
		}
	}
	var out bytes.Buffer
	if err := md.Renderer().Render(&out, source, doc); err != nil {
		return "", err
	}
	return out.String(), nil
}

func pastedDestination(raw string, image bool) bool {
	if strings.HasPrefix(raw, "#") && !image {
		return true
	}
	u, err := url.Parse(raw)
	return err == nil && (u.Scheme == "http" || u.Scheme == "https") && u.Host != ""
}

func rewrite(filename, raw string, image bool) []byte {
	if strings.HasPrefix(raw, "#") && !image {
		return []byte(raw)
	}
	u, err := url.Parse(raw)
	if err != nil {
		return nil
	}
	if u.Scheme == "http" || u.Scheme == "https" {
		return []byte(raw)
	}
	if u.Scheme != "" || u.Host != "" || strings.HasPrefix(raw, "//") || strings.HasPrefix(u.Path, "/") || strings.Contains(u.Path, "\\") {
		return nil
	}
	decoded, err := url.PathUnescape(u.EscapedPath())
	if err != nil {
		return nil
	}
	base := path.Dir(filename)
	resolved := path.Clean(path.Join(base, decoded))
	if decoded == "" || resolved == ".." || strings.HasPrefix(resolved, "../") || strings.HasPrefix(resolved, "/") {
		return nil
	}
	if image {
		return []byte("/api/asset?path=" + url.QueryEscape(resolved))
	}
	fragment := ""
	if u.Fragment != "" {
		fragment = "#" + url.PathEscape(u.Fragment)
	}
	return []byte(fmt.Sprintf("/?path=%s%s", url.QueryEscape(resolved), fragment))
}
