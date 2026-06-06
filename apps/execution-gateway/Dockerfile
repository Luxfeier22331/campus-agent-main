FROM golang:1.26.2-bookworm AS build

ARG GOPROXY=https://proxy.golang.org,direct
ARG GOSUMDB=sum.golang.org

ENV GOPROXY=${GOPROXY} \
  GOSUMDB=${GOSUMDB}

WORKDIR /src/apps/execution-gateway

COPY apps/execution-gateway/go.mod apps/execution-gateway/go.sum ./
RUN go mod download

COPY apps/execution-gateway ./
COPY configs/runtime/agents.v2.json /src/configs/runtime/agents.v2.json
COPY configs/runtime/intent-policy.v1.json /src/configs/runtime/intent-policy.v1.json
COPY configs/runtime/query-serving-scopes.v1.json /src/configs/runtime/query-serving-scopes.v1.json
COPY configs/runtime/tools.v2.json /src/configs/runtime/tools.v2.json
COPY configs/runtime/workflow-artifacts.v1.json /src/configs/runtime/workflow-artifacts.v1.json
COPY tests/fixtures/service_guide_vpn_grouped_procedure_result.json /src/tests/fixtures/service_guide_vpn_grouped_procedure_result.json
COPY tests/fixtures/supervisor_execution_contract /src/tests/fixtures/supervisor_execution_contract

RUN go test ./... \
  && CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/execution-gateway ./cmd/execution-gateway

FROM debian:bookworm-slim

RUN useradd --create-home --uid 10001 --shell /usr/sbin/nologin appuser
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*

COPY --from=build /out/execution-gateway /usr/local/bin/execution-gateway
COPY configs/runtime/agents.v2.json /etc/campus-agent/agents.v2.json
COPY configs/runtime/intent-policy.v1.json /etc/campus-agent/intent-policy.v1.json
COPY configs/runtime/query-serving-scopes.v1.json /etc/campus-agent/query-serving-scopes.v1.json
COPY configs/runtime/tools.v2.json /etc/campus-agent/tools.v2.json
COPY configs/runtime/workflow-artifacts.v1.json /etc/campus-agent/workflow-artifacts.v1.json

USER appuser
EXPOSE 8000
ENV CAMPUS_AGENT_HTTP_HOST=0.0.0.0 \
  EXECUTION_GATEWAY_AGENT_SPEC_PATH=/etc/campus-agent/agents.v2.json \
  EXECUTION_GATEWAY_INTENT_POLICY_PATH=/etc/campus-agent/intent-policy.v1.json \
  EXECUTION_GATEWAY_QUERY_SERVING_SCOPES_PATH=/etc/campus-agent/query-serving-scopes.v1.json \
  EXECUTION_GATEWAY_TOOL_SPEC_PATH=/etc/campus-agent/tools.v2.json \
  EXECUTION_GATEWAY_WORKFLOW_ARTIFACT_REGISTRY_PATH=/etc/campus-agent/workflow-artifacts.v1.json

ENTRYPOINT ["/usr/local/bin/execution-gateway"]
