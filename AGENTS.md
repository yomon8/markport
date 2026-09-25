# Repository Guidelines

## Project Structure & Module Organization

Markport is a local, read-only Markdown and code browser. `cmd/markport/` contains the Go entry point. Backend packages live under `internal/`: `cli` handles arguments, `files` handles safe filesystem access and watching, `render` produces HTML, and `server` serves HTTP. `web/src/` contains the TypeScript UI and CSS; `web/index.html` is its entry page. Vite builds assets into `internal/web/dist/` for embedding by `internal/web/embed.go`. Treat this directory and root `dist/` as generated output. `testdata/` provides sample browsing content.

## Build, Test, and Development Commands

Use Go 1.27, Node.js 24, npm, and Make. Run these commands from the repository root:

- `make setup`: download Go modules and install locked npm dependencies.
- `make dev DIR=./testdata`: start the Go API and Vite at `localhost:5173`.
- `make build VERSION=dev`: build embedded assets and the executable in `dist/`.
- `make run DIR=./testdata PORT=3000`: run the previously built executable.
- `make test`: build assets and run Go tests plus Vitest.
- `make lint`: build assets, then run `go vet`, TypeScript checks, and ESLint.
- `make test-e2e`: build the executable and run Playwright with Chromium. First install browser dependencies using `cd web && npx playwright install --with-deps chromium`.
- `make dist VERSION=v1.0.0`: produce Linux, macOS, and Windows binaries for amd64/arm64 plus checksums.

## Coding Style & Naming Conventions

Format Go with `gofmt`; use standard Go naming and tab indentation. Preserve platform-specific files such as `open_unix.go` and `open_windows.go`. Follow existing TypeScript style: two-space indentation, single quotes, semicolons, camelCase functions, and PascalCase types. Keep strict TypeScript checks and ESLint passing.

## Testing Guidelines

Place Go tests beside implementation files as `*_test.go`, with `TestXxx` functions. UI tests use Vitest with jsdom in `web/tests/*.test.ts`; browser acceptance tests use `web/e2e/*.e2e.ts`. Add regression tests for changed behavior, particularly filesystem safety and refresh handling. No numeric coverage threshold is configured. CI checks all three operating systems and runs browser tests on Linux.

## Commit & Pull Request Guidelines

Use Conventional Commits for every commit message: `type(scope): description`, with the scope optional. Use a concise, imperative description and a standard type such as `feat`, `fix`, `docs`, `refactor`, `test`, or `chore`. Mark breaking changes with `!` and include a `BREAKING CHANGE:` footer. PRs should explain the problem, behavior changes, and validation performed; link relevant issues and include screenshots for visible UI changes. Run `make test` and `make lint`, plus `make test-e2e` for browser behavior changes.
