# Performance implementation measurements

Local comparison for `spec_perf.md` / `tasks.md`, starting from `757c67b`.
Before measurements were collected after adding the benchmark fixtures and before
changing production code. The preserved original executable was also used for
HTTP/process measurements. These are local measurements, not CI thresholds.

Environment: Linux amd64, Go 1.27.1, Node.js 24.21.0,
Intel Core i5-1340P, default GOMAXPROCS=16.

Reproduce the benchmarks (five samples per benchmark):

```sh
go test ./internal/gitdiff ./internal/render ./internal/files \
  -run '^$' -bench . -benchmem -count 5
```

- `BenchmarkListAt`: 50 changed files, including modified, deleted, added,
  staged and unstaged files. One warm-up populates line-count/content caches,
  representing steady polling rather than the first Git view.
- `BenchmarkMarkdown`: 1,045,000 bytes, including 200 Go fenced code blocks.
- `BenchmarkCode`: 3,000 Go functions, with line numbers.
- `BenchmarkSearchContent`: 2,000 files / 21.6 MB, with 20 matching files.
  Production scans stop at 2,000 files, so a 5,000-file fixture would measure an
  intentionally truncated scan. Limits remain unchanged.

Raw benchmark results: [before](bench-before.txt), [after](bench-after.txt).

Five-sample medians (MiB = 1,048,576 bytes):

| Benchmark | Before ms/op | After ms/op | Time change | Before MiB/op | After MiB/op | Allocation bytes change |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `BenchmarkListAt` | 108.49 | 16.45 | -84.8% | 5.03 | 0.55 | -89.1% |
| `BenchmarkMarkdown` | 79.98 | 71.59 | -10.5% | 49.18 | 45.37 | -7.7% |
| `BenchmarkCode` | 178.75 | 185.52 | +3.8% | 59.41 | 59.39 | 0.0% |
| `BenchmarkSearchContent` | 150.48 | 149.60 | -0.6% | 102.74 | 70.27 | -31.6% |

Measure HTTP responses and successful Git process starts on a warmed poll:

```sh
make build VERSION=dev
python3 scripts/measure-perf.py /path/to/before/markport /tmp/before
python3 scripts/measure-perf.py ./dist/markport /tmp/after
```

The script uses `strace -f -e trace=execve`, a temporary repository containing
50 modified files, and curl `-w '%{time_total} %{size_download}'`. It excludes
startup and the initial line-count population from the process count. Rendering
fixtures are copied from `testdata` after counting the Git poll; `large.md`
uses the same 1 MB / 200-fence input as `BenchmarkMarkdown`.

| Metric | Before | After | Change |
| --- | ---: | ---: | ---: |
| Successful Git starts per warmed poll (50 modified files) | 55 | 6 | -89.1% |
| `/api/file?path=README.md` JSON bytes | 1,847 | 1,162 | -37.1% |
| `/api/file?path=sample.py` JSON bytes | 3,590 | 2,155 | -40.0% |
| `/api/file?path=large.md` JSON bytes | 2,632,048 | 1,780,048 | -32.4% |

Raw HTTP/process results: [before](runtime-before.json), [after](runtime-after.json).
Rendering instance reuse has a small effect on these large inputs, where lexing
and rendering dominate. Content search reduces allocated bytes; its wall-time
median was effectively unchanged in this run, so no search latency improvement is claimed.

Wall times in those JSON files are single requests, include tracing/browser-test
contention, and should not be used as latency estimates; use the repeated
benchmarks for timing comparisons. The process counts and byte sizes are exact.

The browser test `reuses hashed assets from the browser cache on a second
navigation` verifies initial network transfer and zero `transferSize` for the
subsequent navigation's `/assets/` resources. Server tests verify immutable
headers only on successful assets, `no-cache` on `/`, and no immutable header on
missing assets. `/api/events` now returns 404.

Validation and compatibility:

- The Paste width test waits for the scheduled animation-frame layout before
  checking the same width bound; its previous immediate assertion was intermittent.
- `make test`, `make lint`, `make test-e2e`: passed (Go tests, 274 Vitest tests, 114 Playwright tests).
- `go test -race ./internal/files ./internal/gitdiff ./internal/render ./internal/server`: passed.
- Windows amd64 and macOS arm64 Git code, plus Windows filesystem tests:
  cross-compilation passed. Execution on those OSes remains a CI check.
- Content reads still use `Store.Open` / `os.Root` before consulting cached
  hashes. Hash keys include path, mtime, size, ctime/change time and file identity.
  Unavailable identity metadata disables caching. Reads overlapping a metadata
  change are not cached. No TTL-only content cache was added.
- Existing filename-index TTL/forced-refresh behavior is retained. Its ETag is
  computed with the path and ignored-path snapshot and reused with that snapshot.
- Restored mtimes (both same-size and different-size writes), replacements,
  permissions, staging, batched literal filenames and scoped diffs have regression
  coverage. Search order, context, Unicode offsets and all four limits are covered.
- Review fingerprints now contain a content digest rather than raw content,
  followed by executable mode and staging metadata. This changes existing review
  fingerprints once, invalidating stored review marks. Staging changes now
  invalidate reviews as explicitly required by T3-5; this replaces the previous
  staging-preserves-reviews contract. English/Japanese README and browser/server
  tests were updated together.
- No remote PRs have been created. This report and
  its raw results are ready to copy into phase PR descriptions. If publishing the
  SSE removal separately, use a breaking-change Conventional Commit and document
  `/api/events` removal in its `BREAKING CHANGE:` footer.
