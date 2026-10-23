package files

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func BenchmarkSearchContent(b *testing.B) {
	dir := b.TempDir()
	plain := strings.Repeat("ordinary text without a match\n", 360)
	// 2,000 files / 20 MiB exercise the complete scan within production limits.
	for i := 0; i < MaxSearchFiles; i++ {
		content := plain
		if i%100 == 0 {
			content += "UNIQUE-NEEDLE\n"
		}
		if err := os.WriteFile(filepath.Join(dir, fmt.Sprintf("file-%04d.txt", i)), []byte(content), 0600); err != nil {
			b.Fatal(err)
		}
	}
	store, err := New(dir)
	if err != nil {
		b.Fatal(err)
	}
	defer store.Close()
	b.SetBytes(int64(len(plain) * MaxSearchFiles))
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		result, err := store.SearchContent(context.Background(), "", "unique-needle")
		if err != nil || len(result.Matches) != 20 || result.Limit != "" {
			b.Fatalf("search: %v, %+v", err, result)
		}
	}
}
