FROM golang:1.22-alpine AS builder
ARG VERSION=dev
ARG COMMIT=none
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build \
    -ldflags "-X main.Version=${VERSION} -X main.Commit=${COMMIT} -s -w" \
    -o /tenantwarden-agent .

FROM scratch
COPY --from=builder /tenantwarden-agent /tenantwarden-agent
COPY --from=builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/
ENTRYPOINT ["/tenantwarden-agent", "start"]
