# syntax=docker/dockerfile:1
FROM --platform=$BUILDPLATFORM golang:1.26.6-bookworm AS build

ARG TARGETOS=linux
ARG TARGETARCH

ARG GOPROXY=https://proxy.golang.org,direct
ARG GOSUMDB=sum.golang.org

ENV GOPROXY=${GOPROXY} \
  GOSUMDB=${GOSUMDB}

WORKDIR /src/apps/execution-control

COPY apps/execution-control/go.mod apps/execution-control/go.sum ./
RUN --mount=type=cache,id=go-modules,target=/go/pkg/mod go mod download

COPY apps/execution-control ./
COPY configs/runtime/tool-function-schemas.v3.json /src/configs/runtime/tool-function-schemas.v3.json
COPY configs/runtime/tools.v6.json /src/configs/runtime/tools.v6.json
COPY packages/contracts/fixtures/tool_execution_contract /src/packages/contracts/fixtures/tool_execution_contract

RUN --mount=type=cache,id=go-modules,target=/go/pkg/mod \
  --mount=type=cache,id=go-build,target=/root/.cache/go-build \
  CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} go build -trimpath -ldflags="-s -w" -o /out/execution-control ./cmd/execution-control \
  && CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} go build -trimpath -ldflags="-s -w" -o /out/run-projection-schema ./cmd/run-projection-schema

FROM debian:bookworm-slim

RUN useradd --create-home --uid 10001 --shell /usr/sbin/nologin appuser
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*

COPY --from=build /out/execution-control /usr/local/bin/execution-control
COPY --from=build /out/run-projection-schema /usr/local/bin/run-projection-schema
COPY configs/runtime/tool-function-schemas.v3.json /etc/campus-agent/tool-function-schemas.v3.json
COPY configs/runtime/tools.v6.json /etc/campus-agent/tools.v6.json

USER appuser
EXPOSE 8000 8001

ENTRYPOINT ["/usr/local/bin/execution-control"]
