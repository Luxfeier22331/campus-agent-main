FROM golang:1.26.2-bookworm AS build

ARG GOPROXY=https://proxy.golang.org,direct
ARG GOSUMDB=sum.golang.org

ENV GOPROXY=${GOPROXY} \
  GOSUMDB=${GOSUMDB}

WORKDIR /src/apps/supervisor-api

COPY apps/supervisor-api/go.mod apps/supervisor-api/go.sum ./
RUN go mod download

COPY apps/supervisor-api ./
COPY configs/runtime/intent-policy.v1.json /src/configs/runtime/intent-policy.v1.json
COPY configs/runtime/query-serving-scopes.v1.json /src/configs/runtime/query-serving-scopes.v1.json

RUN go test ./... \
  && CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/supervisor-api ./cmd/supervisor-api

FROM debian:bookworm-slim

RUN useradd --create-home --uid 10001 --shell /usr/sbin/nologin appuser

COPY --from=build /out/supervisor-api /usr/local/bin/supervisor-api
COPY configs/runtime/intent-policy.v1.json /etc/campus-agent/intent-policy.v1.json
COPY configs/runtime/query-serving-scopes.v1.json /etc/campus-agent/query-serving-scopes.v1.json

USER appuser
EXPOSE 8000
ENV CAMPUS_AGENT_HTTP_HOST=0.0.0.0 \
  SUPERVISOR_API_INTENT_POLICY_PATH=/etc/campus-agent/intent-policy.v1.json \
  SUPERVISOR_API_QUERY_SERVING_SCOPES_PATH=/etc/campus-agent/query-serving-scopes.v1.json

ENTRYPOINT ["/usr/local/bin/supervisor-api"]
