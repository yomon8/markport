# markport

[Read this in Japanese](README.ja.md)

Markport is a CLI for browsing Markdown and code created by AI agents in a local browser. It serves a selected directory in read-only mode. It supports Markdown tables, task lists, and Mermaid diagrams; syntax highlighting for code; relative links and images; and automatic updates when files change.

## Usage

Download the executable for your OS and CPU from the GitHub Releases page. Builds are available for Linux, macOS, and Windows on `amd64` (x64) and `arm64`. The Windows executable has a `.exe` extension. You do not need Go, Node.js, npm, or separate web assets to run it, but you do need a browser.

To verify a download, place `checksums_<version>.txt` from the release alongside the executable. Run `sha256sum --check checksums_<version>.txt` on Linux or `shasum -a 256 -c checksums_<version>.txt` on macOS. On Windows, use `Get-FileHash` to check an individual file.

```sh
./markport_v1.0.0_linux_amd64 ./notes --port 3000
./markport_v1.0.0_linux_amd64 --help
./markport_v1.0.0_linux_amd64 --version
```

With no arguments, Markport serves the current directory on port 3000. Open the `http://127.0.0.1:<port>/` URL printed at startup. Press `Ctrl+C` to stop the server. It listens only on the local machine at `127.0.0.1`.

Markport excludes `.git`, `node_modules`, and `.venv` from browsing and file watching. Other dotfiles remain visible. It does not read symbolic links, Windows junctions, or special files such as FIFOs, and text files are limited to 10 MiB. Binary or unreadable files show an error for that file only. If automatic updates stop, use the refresh button in the browser.

## Development

### Architecture

The Go executable serves the embedded browser UI and read-only API on `127.0.0.1`. It renders content and watches the selected directory for changes.

```mermaid
flowchart LR
    user["User"] -->|"Opens local URL"| browser["Browser UI"]
    browser <-->|"HTTP / SSE"| server["Markport (Go)"]
    server -->|"Read and watch"| directory["Selected directory"]
```

Development requires Go 1.27, Node.js 24, npm, and Make. The devcontainer forwards ports 3000 and 5173.

```sh
make setup                 # Download Go modules and install npm dependencies
make dev DIR=./testdata    # Start the Go API and Vite at localhost:5173
make build VERSION=dev     # Build an executable for the current OS and CPU
make run DIR=./testdata PORT=3000
make test                  # Run Go and UI tests
make test-e2e             # Run Chromium browser tests (requires Playwright browser setup)
make lint                  # Run go vet, TypeScript checks, and ESLint
make dist VERSION=v1.0.0  # Build six executables and SHA-256 checksums
```

After `make setup`, you can run `make lint` on its own. Each relevant Make target builds the web UI and embeds it in the executable. During development, Vite proxies API requests to Go.

Before running browser tests for the first time, install Chromium and its required libraries with `cd web && npx playwright install --with-deps chromium`.

Pushing a `v*` tag triggers GitHub Actions to validate each OS build and create a release for that tag. Before a release, you can also run `make test`, `make lint`, and `make dist VERSION=<tag>` locally. The initial release does not include code signing or macOS notarization.

The initial release does not include editing, comments, diff views, full-text search, standard-input import, or authenticated network hosting.
