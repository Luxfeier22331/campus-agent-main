---
doc_type: runbook
truth_scope: ops
owner_boundary: docs/runbooks
status: active
created: 2026-04-20
updated: 2026-04-20
---
# Legacy Office Conversion Runtime

## Scope

本 runbook 只覆盖 shared file asset loader 的 legacy Office runtime seam：

- `POST /api/internal/legacy-office/conversions`
- `GET /healthz`
- `GET /readyz`

它不重开：

- OCR/provider routing
- `official_web` linked-file adoption
- `authenticated_notice file_release`
- regulation downstream
- query-serving

## Required Contract

Caller env:

- `LEGACY_OFFICE_CONVERSION_BASE_URL`
- `LEGACY_OFFICE_CONVERSION_INTERNAL_SHARED_SECRET`

Optional caller env:

- `LEGACY_OFFICE_CONVERSION_TIMEOUT_SECONDS`

Service env:

- `LEGACY_OFFICE_CONVERSION_INTERNAL_SHARED_SECRET`

Optional service env:

- `LIBREOFFICE_SERVICE_BIND`
- `LIBREOFFICE_SERVICE_TASK_TIMEOUT_MS`
- `LIBREOFFICE_SERVICE_QUEUE_TIMEOUT_MS`
- `LIBREOFFICE_SERVICE_MAX_TASKS_PER_PROCESS`
- `LIBREOFFICE_SERVICE_WORKDIR`
- `LIBREOFFICE_HOME`

Canonical override template:

- [`env/commands/legacy-office-conversion-service.env.example`](../../env/commands/legacy-office-conversion-service.env.example)

## Local Bootstrap

1. Load the canonical local env template into the current shell.
1. Start the repo-owned runtime:

```bash
docker compose --env-file .env \
  -f infra/local/docker-compose.legacy-office-conversion.yml up -d --build
```

1. Probe health:

```bash
curl -sS http://127.0.0.1:8091/healthz
curl -sS http://127.0.0.1:8091/readyz
```

`/healthz` 只表示 service 进程仍在；`/readyz` 必须返回 `200` 才表示 `JODConverter +
LibreOffice` 真正可接单。

## Worker Consumption

Thin worker shell:

```bash
module=campus_ingestion_worker.normalize_authenticated_notice_legacy_office_attachment
uv run --package campus-ingestion-worker python -m "$module" --help
```

Behavior contract:

- worker 只消费 internal HTTP seam
- shared-secret admission 固定走 `x-app-internal-auth`
- worker 不再直接 shell out 到 `soffice`
- `.doc/.xls` 失败时必须 fail-close，不允许本机 CLI fallback

## Real-Asset Verification

Repo-owned verification helper:

```bash
uv run --all-packages python -m \
  scripts.verify_legacy_office_conversion_runtime
  --output-dir .tmp/legacy-office-conversion-runtime \
  --json
```

Expected artifacts:

- `.tmp/legacy-office-conversion-runtime/service-healthz.json`
- `.tmp/legacy-office-conversion-runtime/service-readyz.json`
- `.tmp/legacy-office-conversion-runtime/samples/manifest.json`
- `.tmp/legacy-office-conversion-runtime/doc/result.json`
- `.tmp/legacy-office-conversion-runtime/xls/result.json`
- `.tmp/legacy-office-conversion-runtime/SUMMARY.md`

The helper auto-discovers one real `.doc` and one real `.xls` from the
authenticated notice source bucket. If operators need deterministic sample
selection, pass explicit `--doc-object-key` and `--xls-object-key`.

## Readiness Gate

Before using the worker lane, run:

```bash
uv run --all-packages python -m scripts.doctor_env ingestion --json
```

`ingestion` is not ready unless the OCR/object-store/registry prerequisites and
the legacy Office conversion seam are all present.

## Shutdown

```bash
docker compose --env-file .env \
  -f infra/local/docker-compose.legacy-office-conversion.yml down
```
