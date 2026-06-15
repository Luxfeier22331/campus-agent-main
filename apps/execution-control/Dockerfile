FROM golang:1.26.2-bookworm AS build

ARG GOPROXY=https://proxy.golang.org,direct
ARG GOSUMDB=sum.golang.org

ENV GOPROXY=${GOPROXY} \
  GOSUMDB=${GOSUMDB}

WORKDIR /src/apps/execution-control

COPY apps/execution-control/go.mod apps/execution-control/go.sum ./
RUN go mod download

COPY apps/execution-control ./
COPY configs/runtime/capabilities.v1.json /src/configs/runtime/capabilities.v1.json
COPY configs/runtime/intent-policy.v1.json /src/configs/runtime/intent-policy.v1.json
COPY configs/runtime/provider-pricing.v1.json /src/configs/runtime/provider-pricing.v1.json
COPY configs/runtime/query-serving-scopes.v1.json /src/configs/runtime/query-serving-scopes.v1.json
COPY configs/runtime/tool-catalog.v1.json /src/configs/runtime/tool-catalog.v1.json
COPY configs/runtime/tools.v3.json /src/configs/runtime/tools.v3.json
COPY configs/runtime/workflow-artifacts.v2.json /src/configs/runtime/workflow-artifacts.v2.json
COPY packages/evals/fixtures/tool_function_schemas.v1.json /src/packages/evals/fixtures/tool_function_schemas.v1.json
COPY tests/fixtures/service_guide_vpn_grouped_procedure_result.json /src/tests/fixtures/service_guide_vpn_grouped_procedure_result.json
COPY tests/fixtures/capability_execution_contract /src/tests/fixtures/capability_execution_contract

RUN go test ./... \
  && CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/execution-control ./cmd/execution-control \
  && CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/workflow-worker ./cmd/workflow-worker \
  && CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/activity-worker-context ./cmd/activity-worker-context \
  && CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/activity-worker-agent ./cmd/activity-worker-agent \
  && CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/activity-worker-knowledge ./cmd/activity-worker-knowledge \
  && CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/activity-worker-campus-services ./cmd/activity-worker-campus-services \
  && CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/activity-worker-notice ./cmd/activity-worker-notice \
  && CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/activity-worker-navigation ./cmd/activity-worker-navigation \
  && CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/activity-worker-finalization ./cmd/activity-worker-finalization \
  && CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/worker-autoscaler ./cmd/worker-autoscaler

FROM debian:bookworm-slim

RUN useradd --create-home --uid 10001 --shell /usr/sbin/nologin appuser
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*

COPY --from=build /out/execution-control /usr/local/bin/execution-control
COPY --from=build /out/workflow-worker /usr/local/bin/workflow-worker
COPY --from=build /out/activity-worker-context /usr/local/bin/activity-worker-context
COPY --from=build /out/activity-worker-agent /usr/local/bin/activity-worker-agent
COPY --from=build /out/activity-worker-knowledge /usr/local/bin/activity-worker-knowledge
COPY --from=build /out/activity-worker-campus-services /usr/local/bin/activity-worker-campus-services
COPY --from=build /out/activity-worker-notice /usr/local/bin/activity-worker-notice
COPY --from=build /out/activity-worker-navigation /usr/local/bin/activity-worker-navigation
COPY --from=build /out/activity-worker-finalization /usr/local/bin/activity-worker-finalization
COPY --from=build /out/worker-autoscaler /usr/local/bin/worker-autoscaler
COPY configs/runtime/capabilities.v1.json /etc/campus-agent/capabilities.v1.json
COPY configs/runtime/intent-policy.v1.json /etc/campus-agent/intent-policy.v1.json
COPY configs/runtime/provider-pricing.v1.json /etc/campus-agent/provider-pricing.v1.json
COPY configs/runtime/query-serving-scopes.v1.json /etc/campus-agent/query-serving-scopes.v1.json
COPY configs/runtime/tools.v3.json /etc/campus-agent/tools.v3.json
COPY configs/runtime/workflow-artifacts.v2.json /etc/campus-agent/workflow-artifacts.v2.json

USER appuser
EXPOSE 8000
ENV CAMPUS_AGENT_HTTP_HOST=0.0.0.0 \
  EXECUTION_CONTROL_CAPABILITY_SPEC_PATH=/etc/campus-agent/capabilities.v1.json \
  EXECUTION_CONTROL_INTENT_POLICY_PATH=/etc/campus-agent/intent-policy.v1.json \
  EXECUTION_CONTROL_PROVIDER_PRICING_PATH=/etc/campus-agent/provider-pricing.v1.json \
  EXECUTION_CONTROL_QUERY_SERVING_SCOPES_PATH=/etc/campus-agent/query-serving-scopes.v1.json \
  EXECUTION_CONTROL_TOOL_SPEC_PATH=/etc/campus-agent/tools.v3.json \
  EXECUTION_CONTROL_WORKFLOW_ARTIFACT_REGISTRY_PATH=/etc/campus-agent/workflow-artifacts.v2.json

ENTRYPOINT ["/usr/local/bin/execution-control"]
