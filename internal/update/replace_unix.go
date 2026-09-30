//go:build linux || darwin

package update

import "os"

func replaceExecutable(staged, target string) (string, error) {
	return "", os.Rename(staged, target)
}
