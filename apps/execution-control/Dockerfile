# syntax=docker/dockerfile:1
FROM --platform=$BUILDPLATFORM golang:1.26.5-bookworm AS build

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
COPY configs/runtime/query-serving-targets.v1.json /src/configs/runtime/query-serving-targets.v1.json
COPY configs/runtime/tool-function-schemas.v2.json /src/configs/runtime/tool-function-schemas.v2.json
COPY configs/runtime/tools.v5.json /src/configs/runtime/tools.v5.json
COPY configs/runtime/workflow-artifacts.v2.json /src/configs/runtime/workflow-artifacts.v2.json
COPY configs/ingestion /src/configs/ingestion
COPY packages/contracts/fixtures/tool_execution_contract /src/packages/contracts/fixtures/tool_execution_contract

RUN --mount=type=cache,id=go-modules,target=/go/pkg/mod \
  --mount=type=cache,id=go-build,target=/root/.cache/go-build \
  CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} go build -trimpath -ldflags="-s -w" -o /out/execution-control ./cmd/execution-control \
  && CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} go build -trimpath -ldflags="-s -w" -o /out/workflow-worker ./cmd/workflow-worker \
  && CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} go build -trimpath -ldflags="-s -w" -o /out/activity-worker-core ./cmd/activity-worker-core \
  && CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} go build -trimpath -ldflags="-s -w" -o /out/activity-worker-agent ./cmd/activity-worker-agent \
  && CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} go build -trimpath -ldflags="-s -w" -o /out/provider-config-admin ./cmd/provider-config-admin \
  && CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} go build -trimpath -ldflags="-s -w" -o /out/run-projection-schema ./cmd/run-projection-schema

FROM debian:bookworm-slim

RUN useradd --create-home --uid 10001 --shell /usr/sbin/nologin appuser
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*

COPY --from=build /out/execution-control /usr/local/bin/execution-control
COPY --from=build /out/workflow-worker /usr/local/bin/workflow-worker
COPY --from=build /out/activity-worker-core /usr/local/bin/activity-worker-core
COPY --from=build /out/activity-worker-agent /usr/local/bin/activity-worker-agent
COPY --from=build /out/provider-config-admin /usr/local/bin/provider-config-admin
COPY --from=build /out/run-projection-schema /usr/local/bin/run-projection-schema
COPY configs/runtime/query-serving-targets.v1.json /etc/campus-agent/query-serving-targets.v1.json
COPY configs/runtime/tool-function-schemas.v2.json /etc/campus-agent/tool-function-schemas.v2.json
COPY configs/runtime/tools.v5.json /etc/campus-agent/tools.v5.json
COPY configs/runtime/workflow-artifacts.v2.json /etc/campus-agent/workflow-artifacts.v2.json
COPY configs/ingestion /configs/ingestion

USER appuser
EXPOSE 8000
ENV CAMPUS_AGENT_HTTP_HOST=0.0.0.0

ENTRYPOINT ["/usr/local/bin/execution-control"]
