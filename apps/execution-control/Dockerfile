FROM --platform=$BUILDPLATFORM golang:1.26.4-bookworm AS build

ARG TARGETOS=linux
ARG TARGETARCH

ARG GOPROXY=https://proxy.golang.org,direct
ARG GOSUMDB=sum.golang.org

ENV GOPROXY=${GOPROXY} \
  GOSUMDB=${GOSUMDB}

WORKDIR /src/apps/execution-control

COPY apps/execution-control/go.mod apps/execution-control/go.sum ./
RUN go mod download

COPY apps/execution-control ./
COPY configs/runtime/intent-policy.v1.json /src/configs/runtime/intent-policy.v1.json
COPY configs/runtime/provider-pricing.v1.json /src/configs/runtime/provider-pricing.v1.json
COPY configs/runtime/query-serving-scopes.v2.json /src/configs/runtime/query-serving-scopes.v2.json
COPY configs/runtime/tool-function-schemas.v1.json /src/configs/runtime/tool-function-schemas.v1.json
COPY configs/runtime/tools.v4.json /src/configs/runtime/tools.v4.json
COPY configs/runtime/workflow-artifacts.v2.json /src/configs/runtime/workflow-artifacts.v2.json
COPY configs/runtime/execution-control /src/configs/runtime/execution-control
COPY configs/ingestion /src/configs/ingestion
COPY packages/contracts/fixtures/tool_execution_contract /src/packages/contracts/fixtures/tool_execution_contract

RUN go test ./... \
  && CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} go build -trimpath -ldflags="-s -w" -o /out/execution-control ./cmd/execution-control \
  && CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} go build -trimpath -ldflags="-s -w" -o /out/workflow-worker ./cmd/workflow-worker \
  && CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} go build -trimpath -ldflags="-s -w" -o /out/activity-worker-core ./cmd/activity-worker-core \
  && CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} go build -trimpath -ldflags="-s -w" -o /out/activity-worker-agent ./cmd/activity-worker-agent \
  && CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} go build -trimpath -ldflags="-s -w" -o /out/activity-worker-knowledge ./cmd/activity-worker-knowledge \
  && CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} go build -trimpath -ldflags="-s -w" -o /out/keda-hpa-posture-collector ./cmd/keda-hpa-posture-collector \
  && CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} go build -trimpath -ldflags="-s -w" -o /out/temporal-task-queue-sampler ./cmd/temporal-task-queue-sampler \
  && CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} go build -trimpath -ldflags="-s -w" -o /out/run-projection-schema ./cmd/run-projection-schema \
  && CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} go build -trimpath -ldflags="-s -w" -o /out/worker-autoscaler ./cmd/worker-autoscaler

FROM debian:bookworm-slim

RUN useradd --create-home --uid 10001 --shell /usr/sbin/nologin appuser
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*

COPY --from=build /out/execution-control /usr/local/bin/execution-control
COPY --from=build /out/workflow-worker /usr/local/bin/workflow-worker
COPY --from=build /out/activity-worker-core /usr/local/bin/activity-worker-core
COPY --from=build /out/activity-worker-agent /usr/local/bin/activity-worker-agent
COPY --from=build /out/activity-worker-knowledge /usr/local/bin/activity-worker-knowledge
COPY --from=build /out/keda-hpa-posture-collector /usr/local/bin/keda-hpa-posture-collector
COPY --from=build /out/temporal-task-queue-sampler /usr/local/bin/temporal-task-queue-sampler
COPY --from=build /out/run-projection-schema /usr/local/bin/run-projection-schema
COPY --from=build /out/worker-autoscaler /usr/local/bin/worker-autoscaler
COPY configs/runtime/intent-policy.v1.json /etc/campus-agent/intent-policy.v1.json
COPY configs/runtime/provider-pricing.v1.json /etc/campus-agent/provider-pricing.v1.json
COPY configs/runtime/query-serving-scopes.v2.json /etc/campus-agent/query-serving-scopes.v2.json
COPY configs/runtime/tool-function-schemas.v1.json /etc/campus-agent/tool-function-schemas.v1.json
COPY configs/runtime/execution-control/runtime-config.local.json /etc/campus-agent/runtime-config.local.json
COPY configs/runtime/execution-control/runtime-config.local-provider.json /etc/campus-agent/runtime-config.local-provider.json
COPY configs/runtime/execution-control/runtime-config.staging.json /etc/campus-agent/runtime-config.staging.json
COPY configs/runtime/tools.v4.json /etc/campus-agent/tools.v4.json
COPY configs/runtime/workflow-artifacts.v2.json /etc/campus-agent/workflow-artifacts.v2.json
COPY configs/ingestion /configs/ingestion

USER appuser
EXPOSE 8000
ENV CAMPUS_AGENT_HTTP_HOST=0.0.0.0 \
  EXECUTION_CONTROL_RUNTIME_CONFIG_PATH=/etc/campus-agent/runtime-config.local.json

ENTRYPOINT ["/usr/local/bin/execution-control"]
