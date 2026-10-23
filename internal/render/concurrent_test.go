package render

import (
	"fmt"
	"sync"
	"testing"
)

func TestConcurrentRendering(t *testing.T) {
	const source = "# Title\n\n[a](other.md) ![img](pic.png)\n\n| a | b |\n| - | - |\n| x | y |\n\n$x^2$\n\n$$\ny = 2\n$$\n\n```go\npackage main\n```\n\n```mermaid\ngraph TD; A-->B\n```\n"
	// Build the reference outputs serially, with different link bases.
	expected := make([]string, 24)
	for i := range expected {
		value, err := Markdown(fmt.Sprintf("docs/%d/test.md", i), source)
		if err != nil {
			t.Fatal(err)
		}
		expected[i] = value
	}
	pasted, err := PastedMarkdown(source)
	if err != nil {
		t.Fatal(err)
	}
	code := Code("main.go", "package main\n")
	var wg sync.WaitGroup
	for i := range expected {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			for j := 0; j < 4; j++ {
				got, err := Markdown(fmt.Sprintf("docs/%d/test.md", i), source)
				if err != nil || got != expected[i] {
					t.Errorf("Markdown output differs: %v", err)
				}
				got, err = PastedMarkdown(source)
				if err != nil || got != pasted {
					t.Errorf("pasted output differs: %v", err)
				}
				if Code("main.go", "package main\n") != code {
					t.Error("code output differs")
				}
			}
		}(i)
	}
	wg.Wait()
}
