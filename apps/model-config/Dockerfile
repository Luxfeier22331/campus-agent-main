FROM --platform=$BUILDPLATFORM golang:1.26.9-bookworm AS build

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
RUN --mount=type=cache,id=apt-cache,target=/var/cache/apt,sharing=locked \
  --mount=type=cache,id=apt-lists,target=/var/lib/apt/lists,sharing=locked \
  mv /etc/apt/apt.conf.d/docker-clean /tmp/docker-clean \
  && apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl \
  && useradd --create-home --uid 10001 --shell /usr/sbin/nologin appuser \
  && mv /tmp/docker-clean /etc/apt/apt.conf.d/docker-clean

COPY --from=build /out/model-config /usr/local/bin/model-config
USER appuser
EXPOSE 8000
ENTRYPOINT ["/usr/local/bin/model-config"]
