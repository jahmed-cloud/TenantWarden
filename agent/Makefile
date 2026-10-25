# TenantWarden Agent — Makefile
BINARY     := tenantwarden-agent
VERSION    ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo "dev")
BUILD_TIME := $(shell date -u +"%Y-%m-%dT%H:%M:%SZ")
COMMIT     := $(shell git rev-parse --short HEAD 2>/dev/null || echo "none")
LDFLAGS    := -ldflags "-X main.Version=$(VERSION) -X main.BuildTime=$(BUILD_TIME) -X main.Commit=$(COMMIT) -s -w"
OUTDIR     := dist

.PHONY: all clean build windows linux linux-arm64 macos checksums docker test vet

all: clean vet windows linux linux-arm64 macos checksums

clean:
	@# Empty the folder rather than delete it: the gateway container bind-mounts it
	mkdir -p $(OUTDIR) && rm -rf $(OUTDIR)/*

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

# ── macOS (Intel and Apple silicon) ───────────────────────────────────────────
macos:
	GOOS=darwin GOARCH=amd64 CGO_ENABLED=0 \
		go build $(LDFLAGS) -o $(OUTDIR)/$(BINARY)-darwin-amd64 .
	GOOS=darwin GOARCH=arm64 CGO_ENABLED=0 \
		go build $(LDFLAGS) -o $(OUTDIR)/$(BINARY)-darwin-arm64 .
	@echo "→ $(OUTDIR)/$(BINARY)-darwin-amd64, $(BINARY)-darwin-arm64"

# ── SHA-256 checksums (served next to the binaries at /downloads/) ────────────
checksums:
	cd $(OUTDIR) && sha256sum $(BINARY)* > SHA256SUMS
	@echo "→ $(OUTDIR)/SHA256SUMS"

# ── Docker image ──────────────────────────────────────────────────────────────
docker:
	docker build -t tenantwarden/agent:$(VERSION) \
		--build-arg VERSION=$(VERSION) \
		--build-arg COMMIT=$(COMMIT) \
		-f Dockerfile .

# ── Tests ─────────────────────────────────────────────────────────────────────
test:
	go test ./... -v -race -count=1

vet:
	GOOS=linux   go vet ./...
	GOOS=windows go vet ./...
	GOOS=darwin  go vet ./...

lint:
	golangci-lint run ./...

# ── Print version ─────────────────────────────────────────────────────────────
version:
	@echo $(VERSION)
