package files

import (
	"fmt"
	"path"
	"strings"
)

// ParseSearchPatterns normalizes the API's comma-separated path filters.
func ParseSearchPatterns(raw string) ([]string, error) {
	if strings.TrimSpace(raw) == "" {
		return nil, nil
	}
	return normalizePatterns(strings.Split(raw, ","))
}

func normalizePatterns(patterns []string) ([]string, error) {
	if len(patterns) > 20 {
		return nil, fmt.Errorf("%w: at most 20 path patterns are allowed", ErrQuery)
	}
	var normalized []string
	for _, pattern := range patterns {
		pattern = strings.TrimSpace(pattern)
		if pattern == "" {
			continue
		}
		for _, part := range strings.Split(pattern, "/") {
			if part == "" || part == "." || part == ".." {
				return nil, fmt.Errorf("%w: invalid path pattern %q", ErrQuery, pattern)
			}
			if _, err := path.Match(part, ""); err != nil {
				return nil, fmt.Errorf("%w: invalid path pattern %q: %v", ErrQuery, pattern, err)
			}
		}
		normalized = append(normalized, pattern)
	}
	return normalized, nil
}

func matchSearchPattern(pattern, name string) bool {
	if !strings.Contains(pattern, "/") {
		matched, _ := path.Match(pattern, path.Base(name))
		return matched
	}
	parts, names := strings.Split(pattern, "/"), strings.Split(name, "/")
	type position struct{ pattern, name int }
	memo := make(map[position]bool)
	seen := make(map[position]bool)
	var match func(int, int) bool
	match = func(p, n int) bool {
		key := position{p, n}
		if seen[key] {
			return memo[key]
		}
		seen[key] = true
		result := false
		if p == len(parts) {
			result = n == len(names)
		} else if parts[p] == "**" {
			result = match(p+1, n) || n < len(names) && match(p, n+1)
		} else if n < len(names) {
			ok, _ := path.Match(parts[p], names[n])
			result = ok && match(p+1, n+1)
		}
		memo[key] = result
		return result
	}
	return match(0, 0)
}

func searchPathIncluded(name string, include, exclude []string) bool {
	for _, pattern := range exclude {
		if matchSearchPattern(pattern, name) {
			return false
		}
	}
	if len(include) == 0 {
		return true
	}
	for _, pattern := range include {
		if matchSearchPattern(pattern, name) {
			return true
		}
	}
	return false
}
