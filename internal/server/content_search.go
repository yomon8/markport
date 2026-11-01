package server

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/markport/markport/internal/files"
)

func (s *Server) contentSearch(w http.ResponseWriter, r *http.Request) {
	params := r.URL.Query()
	for _, values := range params {
		if len(values) != 1 {
			apiError(w, files.ErrPath)
			return
		}
	}
	query := strings.TrimSpace(params.Get("q"))
	if query == "" || utf8.RuneCountInString(query) > 200 {
		apiError(w, files.ErrPath)
		return
	}
	include, err := files.ParseSearchPatterns(params.Get("include"))
	if err != nil {
		apiError(w, err)
		return
	}
	exclude, err := files.ParseSearchPatterns(params.Get("exclude"))
	if err != nil {
		apiError(w, err)
		return
	}
	opts := files.SearchOptions{
		Folder: params.Get("folder"), Query: query,
		CaseSensitive: params.Get("case") == "1", WholeWord: params.Get("word") == "1", Regex: params.Get("regex") == "1",
		Include: include, Exclude: exclude, Candidates: []string{},
	}
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	// Validate the query and requested directory before walking the index.
	if _, err := s.Files.Search(ctx, opts); err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			jsonReply(w, http.StatusOK, files.ContentSearch{Matches: []files.ContentMatch{}, Limit: "timeout"})
		} else if !errors.Is(err, context.Canceled) {
			apiError(w, err)
		}
		return
	}
	paths, ignored, _, err := s.cachedSearchPaths(ctx, false)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			jsonReply(w, http.StatusOK, files.ContentSearch{Matches: []files.ContentMatch{}, Limit: "timeout"})
		} else if !errors.Is(err, context.Canceled) {
			apiError(w, err)
		}
		return
	}
	ignoredPaths := make(map[string]bool, len(ignored))
	for _, name := range ignored {
		ignoredPaths[name] = true
	}
	skipped := 0
	for _, name := range paths {
		if opts.Folder != "" && !strings.HasPrefix(name, opts.Folder+"/") {
			continue
		}
		if ignoredPaths[name] {
			if params.Get("ignored") == "1" {
				opts.Deferred = append(opts.Deferred, name)
			} else {
				skipped++
			}
		} else {
			opts.Candidates = append(opts.Candidates, name)
		}
	}
	result, err := s.Files.Search(ctx, opts)
	result.IgnoredSkipped = skipped
	if errors.Is(err, context.DeadlineExceeded) {
		result.Limit = "timeout"
	} else if err != nil {
		if !errors.Is(err, context.Canceled) {
			apiError(w, err)
		}
		return
	}
	jsonReply(w, http.StatusOK, result)
}
