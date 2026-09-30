package update

import "os"

func replaceExecutable(staged, target string) (string, error) {
	return replaceWindows(staged, target, os.Rename, os.Remove)
}
