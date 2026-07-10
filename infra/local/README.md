# Local Compose Harnesses

## Boundary

`infra/local` contains local Docker Compose harnesses only. It is not the
production deployment owner; K8s/GitOps owns staging and future production
runtime lifecycle.

Each compose file owns one narrow local concern:

- `docker-compose.execution-runtime.yml`: execution-control, agent-runtime,
  Temporal, Hindsight and runtime workers for local execution diagnostics.
- `docker-compose.execution-runtime.fanout.yml`: optional OTel fan-out overlay
  for local external sink testing.
- `docker-compose.langfuse.yml`: optional self-hosted Langfuse dependency stack
  for local fan-out testing.
- `docker-compose.postgres.yml`: shared local Postgres only.
- `docker-compose.ingestion-control.yml`: local ingestion-control service.
- `docker-compose.object-store.yml`: local S3-compatible object store.
- `docker-compose.qdrant.yml`: local non-TLS Qdrant.
- `docker-compose.qdrant-tls.yml`: TLS Qdrant harness for TLS-specific local
  checks.

## Rules

- Do not put app or job services into dependency compose files such as
  `postgres`, `object-store` or `qdrant`.
- Do not add staging lifecycle scripts here. Staging uses GitOps runbooks and
  K8s manifests.
- Add a new compose file only when the runtime boundary is distinct and cannot
  be expressed as an explicit overlay.
