# syntax=docker/dockerfile:1
FROM --platform=$BUILDPLATFORM golang:1.26.7-bookworm AS build
ARG TARGETOS=linux
ARG TARGETARCH
WORKDIR /src/apps/memory-service
COPY packages/memory-api-go/ /src/packages/memory-api-go/
COPY apps/memory-service/go.mod apps/memory-service/go.sum ./
RUN --mount=type=cache,id=go-modules,target=/go/pkg/mod go mod download
COPY apps/memory-service/ ./
RUN --mount=type=cache,id=go-modules,target=/go/pkg/mod --mount=type=cache,id=go-build,target=/root/.cache/go-build \
 CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} go build -trimpath -ldflags="-s -w" -o /out/memory-api ./cmd/memory-api \
 && CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} go build -trimpath -ldflags="-s -w" -o /out/memory-worker ./cmd/memory-worker \
 && CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} go build -trimpath -ldflags="-s -w" -o /out/memory-config-upgrade ./cmd/memory-config-upgrade
FROM debian:bookworm-slim
RUN useradd --uid 10001 --create-home --shell /usr/sbin/nologin appuser \
 && apt-get update && apt-get install -y --no-install-recommends ca-certificates curl && rm -rf /var/lib/apt/lists/*
COPY --from=build /out/ /usr/local/bin/
USER appuser
EXPOSE 8000
ENTRYPOINT ["/usr/local/bin/memory-api"]
