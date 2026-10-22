FROM --platform=$BUILDPLATFORM golang:1.26.9-bookworm AS build
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
RUN --mount=type=cache,id=apt-cache,target=/var/cache/apt,sharing=locked \
  --mount=type=cache,id=apt-lists,target=/var/lib/apt/lists,sharing=locked \
  mv /etc/apt/apt.conf.d/docker-clean /tmp/docker-clean \
  && apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl \
  && useradd --create-home --uid 10001 --shell /usr/sbin/nologin appuser \
  && mv /tmp/docker-clean /etc/apt/apt.conf.d/docker-clean

COPY --from=build /out/ /usr/local/bin/
USER appuser
EXPOSE 8000
ENTRYPOINT ["/usr/local/bin/memory-api"]
