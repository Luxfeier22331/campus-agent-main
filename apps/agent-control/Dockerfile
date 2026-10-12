# syntax=docker/dockerfile:1
FROM --platform=$BUILDPLATFORM golang:1.26.7-bookworm AS build

ARG TARGETOS=linux
ARG TARGETARCH

ARG GOPROXY=https://proxy.golang.org,direct
ARG GOSUMDB=sum.golang.org

ENV GOPROXY=${GOPROXY} \
  GOSUMDB=${GOSUMDB}

WORKDIR /src
COPY packages/search-api-go/ packages/search-api-go/

COPY apps/agent-control/go.mod apps/agent-control/go.sum apps/agent-control/
COPY packages/memory-api-go/ packages/memory-api-go/
RUN --mount=type=cache,id=go-modules,target=/go/pkg/mod cd apps/agent-control && go mod download

COPY apps/agent-control/cmd apps/agent-control/cmd
COPY apps/agent-control/internal apps/agent-control/internal

COPY configs/runtime/tool-function-schemas.v4.json /src/configs/runtime/tool-function-schemas.v4.json
COPY configs/runtime/tools.v7.json /src/configs/runtime/tools.v7.json
COPY packages/contracts/fixtures/tool_execution_contract /src/packages/contracts/fixtures/tool_execution_contract

RUN --mount=type=cache,id=go-modules,target=/go/pkg/mod \
  --mount=type=cache,id=go-build,target=/root/.cache/go-build \
  CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} go build -C apps/agent-control -trimpath -ldflags="-s -w" -o /out/agent-control ./cmd/agent-control

FROM debian:bookworm-slim

RUN useradd --create-home --uid 10001 --shell /usr/sbin/nologin appuser
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*

COPY --from=build /out/ /usr/local/bin/
COPY configs/runtime/tool-function-schemas.v4.json /etc/campus-agent/tool-function-schemas.v4.json
COPY configs/runtime/tools.v7.json /etc/campus-agent/tools.v7.json

USER appuser
EXPOSE 8000

ENTRYPOINT ["/usr/local/bin/agent-control"]
