package files

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestReadTextFrom(t *testing.T) {
	dir := t.TempDir()
	store, err := New(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	for _, test := range []struct {
		name, content string
		want          error
	}{
		{"text", "日本語\n\t\r\f", nil},
		{"invalid-utf8", string([]byte{0xff}), ErrBinary},
		{"binary", "abc\x00", ErrBinary},
		{"control", "abc\x01", ErrBinary},
		{"large", strings.Repeat("x", MaxTextSize+1), ErrTooLarge},
		{"exact", strings.Repeat("x", MaxTextSize), nil},
	} {
		t.Run(test.name, func(t *testing.T) {
			if err := os.WriteFile(filepath.Join(dir, test.name), []byte(test.content), 0600); err != nil {
				t.Fatal(err)
			}
			file, err := store.Open(test.name)
			if err != nil {
				t.Fatal(err)
			}
			defer file.Close()
			info, err := file.Stat()
			if err != nil {
				t.Fatal(err)
			}
			got, err := store.ReadTextFrom(file, info)
			if !errors.Is(err, test.want) || (err == nil && got != test.content) {
				t.Fatalf("ReadTextFrom: length=%d err=%v", len(got), err)
			}
			ordinary, readErr := store.ReadText(test.name)
			if ordinary != got || !errors.Is(readErr, test.want) {
				t.Fatalf("ReadText differs: %v", readErr)
			}
		})
	}
	// The bounded read must also reject growth after the ETag stat.
	file, err := store.Open("text")
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "text"), []byte(strings.Repeat("x", MaxTextSize+1)), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := store.ReadTextFrom(file, info); !errors.Is(err, ErrTooLarge) {
		t.Fatalf("growth: %v", err)
	}
}
