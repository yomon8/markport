package gitdiff

import (
	"io/fs"
	"os"
	"unsafe"

	"golang.org/x/sys/windows"
)

type fileIdentity struct {
	volume              uint32
	indexHigh, indexLow uint32
	changeTime          int64
}

func identifyFile(file *os.File, _ fs.FileInfo) (fileIdentity, bool) {
	var id windows.ByHandleFileInformation
	// FILE_BASIC_INFO includes the change time, unlike os.FileInfo.ModTime.
	var basic struct {
		creation, access, write, change int64
		attributes                      uint32
		padding                         uint32
	}
	conn, err := file.SyscallConn()
	if err != nil {
		return fileIdentity{}, false
	}
	var statErr error
	err = conn.Control(func(handle uintptr) {
		statErr = windows.GetFileInformationByHandle(windows.Handle(handle), &id)
		if statErr == nil {
			statErr = windows.GetFileInformationByHandleEx(windows.Handle(handle), windows.FileBasicInfo, (*byte)(unsafe.Pointer(&basic)), uint32(unsafe.Sizeof(basic)))
		}
	})
	if err != nil || statErr != nil {
		return fileIdentity{}, false
	}
	return fileIdentity{id.VolumeSerialNumber, id.FileIndexHigh, id.FileIndexLow, basic.change}, true
}
