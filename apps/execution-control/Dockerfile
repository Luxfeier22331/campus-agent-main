FROM golang:1.26.2-bookworm AS build

ARG GOPROXY=https://proxy.golang.org,direct
ARG GOSUMDB=sum.golang.org

ENV GOPROXY=${GOPROXY} \
  GOSUMDB=${GOSUMDB}

WORKDIR /src/apps/execution-control

COPY apps/execution-control/go.mod apps/execution-control/go.sum ./
RUN go mod download

COPY apps/execution-control ./
COPY configs/runtime/agents.v2.json /src/configs/runtime/agents.v2.json
COPY configs/runtime/intent-policy.v1.json /src/configs/runtime/intent-policy.v1.json
COPY configs/runtime/query-serving-scopes.v1.json /src/configs/runtime/query-serving-scopes.v1.json
COPY configs/runtime/tools.v2.json /src/configs/runtime/tools.v2.json
COPY configs/runtime/workflow-artifacts.v1.json /src/configs/runtime/workflow-artifacts.v1.json
COPY tests/fixtures/service_guide_vpn_grouped_procedure_result.json /src/tests/fixtures/service_guide_vpn_grouped_procedure_result.json
COPY tests/fixtures/supervisor_execution_contract /src/tests/fixtures/supervisor_execution_contract

RUN go test ./... \
  && CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/execution-control ./cmd/execution-control \
  && CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/workflow-worker ./cmd/workflow-worker \
  && CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/activity-worker-rag ./cmd/activity-worker-rag \
  && CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/activity-worker-finalization ./cmd/activity-worker-finalization \
  && CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/worker-autoscaler ./cmd/worker-autoscaler

FROM debian:bookworm-slim

RUN useradd --create-home --uid 10001 --shell /usr/sbin/nologin appuser
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*

COPY --from=build /out/execution-control /usr/local/bin/execution-control
COPY --from=build /out/workflow-worker /usr/local/bin/workflow-worker
COPY --from=build /out/activity-worker-rag /usr/local/bin/activity-worker-rag
COPY --from=build /out/activity-worker-finalization /usr/local/bin/activity-worker-finalization
COPY --from=build /out/worker-autoscaler /usr/local/bin/worker-autoscaler
COPY configs/runtime/agents.v2.json /etc/campus-agent/agents.v2.json
COPY configs/runtime/intent-policy.v1.json /etc/campus-agent/intent-policy.v1.json
COPY configs/runtime/query-serving-scopes.v1.json /etc/campus-agent/query-serving-scopes.v1.json
COPY configs/runtime/tools.v2.json /etc/campus-agent/tools.v2.json
COPY configs/runtime/workflow-artifacts.v1.json /etc/campus-agent/workflow-artifacts.v1.json

USER appuser
EXPOSE 8000
ENV CAMPUS_AGENT_HTTP_HOST=0.0.0.0 \
  EXECUTION_CONTROL_AGENT_SPEC_PATH=/etc/campus-agent/agents.v2.json \
  EXECUTION_CONTROL_INTENT_POLICY_PATH=/etc/campus-agent/intent-policy.v1.json \
  EXECUTION_CONTROL_QUERY_SERVING_SCOPES_PATH=/etc/campus-agent/query-serving-scopes.v1.json \
  EXECUTION_CONTROL_TOOL_SPEC_PATH=/etc/campus-agent/tools.v2.json \
  EXECUTION_CONTROL_WORKFLOW_ARTIFACT_REGISTRY_PATH=/etc/campus-agent/workflow-artifacts.v1.json

ENTRYPOINT ["/usr/local/bin/execution-control"]
