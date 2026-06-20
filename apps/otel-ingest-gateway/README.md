# otel-ingest-gateway

Controlled OTLP HTTP ingest gateway for Worker-origin telemetry.

It only validates machine-to-machine ingress and forwards accepted OTLP HTTP
traffic to the repo-owned Collector:

- `POST /v1/traces`
- `POST /v1/logs`
- `GET /healthz`
- `GET /readyz`

Required runtime environment:

- `OTEL_INGEST_SHARED_SECRET`
- `OTEL_INGEST_COLLECTOR_HTTP_ENDPOINT`

Optional runtime environment:

- `OTEL_INGEST_HOST`, default `0.0.0.0`
- `OTEL_INGEST_PORT`, default `8000`
- `OTEL_INGEST_MAX_BODY_BYTES`, default `1048576`
