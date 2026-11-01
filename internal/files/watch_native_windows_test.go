package files

import (
	"encoding/binary"
	"path/filepath"
	"reflect"
	"testing"
	"unicode/utf16"

	"github.com/fsnotify/fsnotify"
	"golang.org/x/sys/windows"
)

func TestWindowsChangeEvents(t *testing.T) {
	type notification struct {
		action uint32
		name   string
	}
	var data []byte
	for i, n := range []notification{
		{windows.FILE_ACTION_ADDED, `sub\日本語.md`},
		{windows.FILE_ACTION_RENAMED_OLD_NAME, `sub\old.md`},
		{windows.FILE_ACTION_RENAMED_NEW_NAME, `sub\new.md`},
		{windows.FILE_ACTION_MODIFIED, `sub\new.md`},
		{windows.FILE_ACTION_REMOVED, `sub\new.md`},
	} {
		name := utf16.Encode([]rune(n.name))
		record := make([]byte, (12+len(name)*2+3)&^3)
		if i < 4 {
			binary.LittleEndian.PutUint32(record, uint32(len(record)))
		}
		binary.LittleEndian.PutUint32(record[4:], n.action)
		binary.LittleEndian.PutUint32(record[8:], uint32(len(name)*2))
		for j, c := range name {
			binary.LittleEndian.PutUint16(record[12+j*2:], c)
		}
		data = append(data, record...)
	}
	root := `C:\project`
	got, err := windowsChangeEvents(root, data)
	want := []fsnotify.Event{
		{Name: filepath.Join(root, `sub\日本語.md`), Op: fsnotify.Create},
		{Name: filepath.Join(root, `sub\old.md`), Op: fsnotify.Rename},
		{Name: filepath.Join(root, `sub\new.md`), Op: fsnotify.Create},
		{Name: filepath.Join(root, `sub\new.md`), Op: fsnotify.Write},
		{Name: filepath.Join(root, `sub\new.md`), Op: fsnotify.Remove},
	}
	if err != nil || !reflect.DeepEqual(got, want) {
		t.Fatalf("notifications = %+v, %v", got, err)
	}
	for _, bad := range [][]byte{nil, data[:11], data[:13]} {
		if _, err := windowsChangeEvents(root, bad); err == nil {
			t.Fatalf("accepted malformed notification: %x", bad)
		}
	}
}
