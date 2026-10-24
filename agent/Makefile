# TenantWarden Agent — Makefile
BINARY     := tenantwarden-agent
VERSION    ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo "dev")
BUILD_TIME := $(shell date -u +"%Y-%m-%dT%H:%M:%SZ")
COMMIT     := $(shell git rev-parse --short HEAD 2>/dev/null || echo "none")
LDFLAGS    := -ldflags "-X main.Version=$(VERSION) -X main.BuildTime=$(BUILD_TIME) -X main.Commit=$(COMMIT) -s -w"
OUTDIR     := dist

.PHONY: all clean build windows linux linux-arm64 macos docker test

all: clean windows linux linux-arm64 macos

clean:
	rm -rf $(OUTDIR)
	mkdir -p $(OUTDIR)

# ── Local build ───────────────────────────────────────────────────────────────
build:
	go build $(LDFLAGS) -o $(OUTDIR)/$(BINARY) .

# ── Windows x86-64 ────────────────────────────────────────────────────────────
windows:
	GOOS=windows GOARCH=amd64 CGO_ENABLED=0 \
		go build $(LDFLAGS) -o $(OUTDIR)/$(BINARY).exe .
	@echo "→ $(OUTDIR)/$(BINARY).exe"

# ── Linux x86-64 (static) ─────────────────────────────────────────────────────
linux:
	GOOS=linux GOARCH=amd64 CGO_ENABLED=0 \
		go build $(LDFLAGS) -o $(OUTDIR)/$(BINARY)-linux-amd64 .
	@echo "→ $(OUTDIR)/$(BINARY)-linux-amd64"

# ── Linux ARM64 (Raspberry Pi / cloud ARM) ────────────────────────────────────
linux-arm64:
	GOOS=linux GOARCH=arm64 CGO_ENABLED=0 \
		go build $(LDFLAGS) -o $(OUTDIR)/$(BINARY)-linux-arm64 .
	@echo "→ $(OUTDIR)/$(BINARY)-linux-arm64"

# ── macOS universal ───────────────────────────────────────────────────────────
macos:
	GOOS=darwin GOARCH=amd64 CGO_ENABLED=0 \
		go build $(LDFLAGS) -o $(OUTDIR)/$(BINARY)-darwin-amd64 .
	GOOS=darwin GOARCH=arm64 CGO_ENABLED=0 \
		go build $(LDFLAGS) -o $(OUTDIR)/$(BINARY)-darwin-arm64 .
	lipo -create -output $(OUTDIR)/$(BINARY)-darwin-universal \
		$(OUTDIR)/$(BINARY)-darwin-amd64 \
		$(OUTDIR)/$(BINARY)-darwin-arm64 2>/dev/null || \
		cp $(OUTDIR)/$(BINARY)-darwin-amd64 $(OUTDIR)/$(BINARY)-darwin-universal
	@echo "→ $(OUTDIR)/$(BINARY)-darwin-universal"

# ── Docker image ──────────────────────────────────────────────────────────────
docker:
	docker build -t tenantwarden/agent:$(VERSION) \
		--build-arg VERSION=$(VERSION) \
		--build-arg COMMIT=$(COMMIT) \
		-f Dockerfile .

# ── Tests ─────────────────────────────────────────────────────────────────────
test:
	go test ./... -v -race -count=1

lint:
	golangci-lint run ./...

# ── Print version ─────────────────────────────────────────────────────────────
version:
	@echo $(VERSION)
