GO ?= go
NPM ?= npm
VERSION ?= dev
DIR ?= .
PORT ?= 3000
BIN := dist/markport$(if $(filter windows,$(shell $(GO) env GOOS)),.exe,)

.PHONY: setup web-build dev build run test test-e2e lint dist

setup:
	$(GO) mod download
	cd web && $(NPM) ci

web-build:
	cd web && $(NPM) run build

dev: web-build
	@set -e; MARKPORT_PORT=$(PORT) $(GO) run ./cmd/markport $(DIR) --port $(PORT) & go_pid=$$!; \
	  (cd web && MARKPORT_PORT=$(PORT) $(NPM) run dev) & vite_pid=$$!; \
	  trap 'kill $$go_pid $$vite_pid 2>/dev/null || true' EXIT INT TERM; wait

build: web-build
	mkdir -p dist
	CGO_ENABLED=0 $(GO) build -ldflags '-X github.com/markport/markport/internal/cli.Version=$(VERSION)' -o $(BIN) ./cmd/markport

run:
	$(BIN) $(DIR) --port $(PORT)

test: web-build
	$(GO) test ./cmd/... ./internal/...
	cd web && $(NPM) test

test-e2e: build
	cd web && $(NPM) run test:e2e

lint: web-build
	$(GO) vet ./...
	cd web && $(NPM) run lint

dist: web-build
	mkdir -p dist
	@set -e; for os in linux darwin windows; do \
	  for arch in amd64 arm64; do \
	    suffix=''; if [ "$$os" = windows ]; then suffix='.exe'; fi; \
	    name="markport_$(VERSION)_$${os}_$${arch}$${suffix}"; \
	    echo "Building $$name"; \
	    CGO_ENABLED=0 GOOS=$$os GOARCH=$$arch $(GO) build -ldflags '-X github.com/markport/markport/internal/cli.Version=$(VERSION)' -o "dist/$$name" ./cmd/markport; \
	  done; \
	done
	cd dist && (if command -v sha256sum >/dev/null; then sha256sum markport_$(VERSION)_*; else shasum -a 256 markport_$(VERSION)_*; fi) > checksums_$(VERSION).txt
