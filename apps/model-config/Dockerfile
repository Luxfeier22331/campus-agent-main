# syntax=docker/dockerfile:1
FROM --platform=$BUILDPLATFORM golang:1.26.7-bookworm AS build

ARG TARGETOS=linux
ARG TARGETARCH
ARG GOPROXY=https://proxy.golang.org,direct
ARG GOSUMDB=sum.golang.org

ENV GOPROXY=${GOPROXY} GOSUMDB=${GOSUMDB}
WORKDIR /src/apps/model-config

COPY apps/model-config/go.mod apps/model-config/go.sum ./
RUN --mount=type=cache,id=go-model-config-modules,target=/go/pkg/mod go mod download
COPY apps/model-config/cmd ./cmd
COPY apps/model-config/internal ./internal

RUN --mount=type=cache,id=go-model-config-modules,target=/go/pkg/mod \
    --mount=type=cache,id=go-model-config-build,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} go build -trimpath -ldflags="-s -w" -o /out/model-config ./cmd/model-config

FROM debian:bookworm-slim
RUN useradd --create-home --uid 10001 --shell /usr/sbin/nologin appuser \
    && apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /out/model-config /usr/local/bin/model-config
USER appuser
EXPOSE 8000
ENTRYPOINT ["/usr/local/bin/model-config"]
