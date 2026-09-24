//go:build windows

package files

import (
	"os"
	"path"
	"path/filepath"
	"unsafe"

	"golang.org/x/sys/windows"
)

type attributeTag struct {
	Attributes uint32
	Tag        uint32
}

func (s *Store) openParts(parts []string, directory bool) (*os.File, error) {
	base, err := s.root.Open(".")
	if err != nil {
		return nil, err
	}
	if len(parts) == 0 {
		return base, nil
	}
	parent := windows.Handle(base.Fd())
	for i, part := range parts {
		name, err := windows.NewNTUnicodeString(part)
		if err != nil {
			if i == 0 {
				base.Close()
			} else {
				windows.CloseHandle(parent)
			}
			return nil, err
		}
		attrs := windows.OBJECT_ATTRIBUTES{RootDirectory: parent, ObjectName: name}
		attrs.Length = uint32(unsafe.Sizeof(attrs))
		options := uint32(windows.FILE_OPEN_REPARSE_POINT | windows.FILE_SYNCHRONOUS_IO_NONALERT)
		if i < len(parts)-1 || directory {
			options |= windows.FILE_DIRECTORY_FILE
		} else {
			options |= windows.FILE_NON_DIRECTORY_FILE
		}
		var next windows.Handle
		err = windows.NtCreateFile(&next, windows.FILE_GENERIC_READ, &attrs, &windows.IO_STATUS_BLOCK{}, nil, windows.FILE_ATTRIBUTE_NORMAL,
			windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE|windows.FILE_SHARE_DELETE, windows.FILE_OPEN, options, 0, 0)
		if i == 0 {
			base.Close()
		} else {
			windows.CloseHandle(parent)
		}
		if err != nil {
			if status, ok := err.(windows.NTStatus); ok {
				return nil, status.Errno()
			}
			return nil, err
		}
		parent = next
		var tag attributeTag
		if err := windows.GetFileInformationByHandleEx(parent, windows.FileAttributeTagInfo, (*byte)(unsafe.Pointer(&tag)), uint32(unsafe.Sizeof(tag))); err != nil {
			windows.CloseHandle(parent)
			return nil, err
		}
		if tag.Attributes&windows.FILE_ATTRIBUTE_REPARSE_POINT != 0 {
			windows.CloseHandle(parent)
			return nil, ErrType
		}
	}
	return os.NewFile(uintptr(parent), filepath.Join(s.Path, filepath.FromSlash(path.Join(parts...)))), nil
}
