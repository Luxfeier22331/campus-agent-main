# syntax=docker/dockerfile:1
FROM --platform=$BUILDPLATFORM golang:1.26.9-bookworm AS build

ARG TARGETOS=linux
ARG TARGETARCH
ARG GOPROXY=https://proxy.golang.org,direct
ARG GOSUMDB=sum.golang.org

ENV GOPROXY=${GOPROXY} \
  GOSUMDB=${GOSUMDB}

WORKDIR /src
COPY packages/search-api-go/ packages/search-api-go/
COPY apps/campus-search/go.mod apps/campus-search/go.sum apps/campus-search/
RUN --mount=type=cache,id=go-modules,target=/go/pkg/mod cd apps/campus-search && go mod download
COPY apps/campus-search/campussearch apps/campus-search/campussearch
COPY apps/campus-search/internal apps/campus-search/internal
COPY apps/campus-search/cmd apps/campus-search/cmd

RUN --mount=type=cache,id=go-modules,target=/go/pkg/mod \
  --mount=type=cache,id=go-build,target=/root/.cache/go-build \
  CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} go build -C apps/campus-search -trimpath -ldflags="-s -w" -o /out/campus-search-service ./cmd/campus-search-service

FROM debian:bookworm-slim
RUN useradd --create-home --uid 10001 --shell /usr/sbin/nologin appuser
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl && rm -rf /var/lib/apt/lists/*
COPY --from=build /out/campus-search-service /usr/local/bin/campus-search-service
USER appuser
EXPOSE 8000
ENTRYPOINT ["/usr/local/bin/campus-search-service"]
