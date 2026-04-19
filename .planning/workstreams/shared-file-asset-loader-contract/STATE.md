---
workstream: shared-file-asset-loader-contract
created: 2026-04-19
updated: 2026-04-20
---

# Project State

## Current Position

**Status:** Completed
**Current Phase:** Completed
**Current Phase Name:** Phase H Closeout
**Current Plan:** None
**Total Phases:** 8
**Total Plans in Phase:** 3
**Progress:** 8/8 phases complete
**Last Activity:** 2026-04-20
**Last Activity Description:** Completed `Phase H` closeout: service-backed caller seam、standalone conversion runtime、env/docs/runbook truth 与真实 `.doc/.xls` evidence 全部落盘。

## Current Slice

- Phase A-G 的 shared owner、family adapters、authenticated-notice attachment migration、cross-scope adoption、planning closeout 与 OCR lane-first provider realignment 历史继续保留。
- `Phase H` 已完成并把 reopen gap 全部收口：
  - `legacy_office_conversion_client.py` 已冻结 repo-owned caller seam；缺少 env、transport 失败、hash mismatch 与非法响应都会 fail-close。
  - `file_asset_legacy_office.py` 与 `campus-ingestion-normalize-authenticated-notice-legacy-office-attachment` 已完全切到 service-backed path，不再直接调用 `soffice --convert-to`。
  - repo 已拥有独立 `apps/legacy-office-conversion-service` runtime、local compose bootstrap、`GET /healthz` / `GET /readyz` readiness gate 与 `x-app-internal-auth` admission。
  - `docs/architecture/file-asset-loader-architecture.md`、`docs/environment/README.md`、`docs/runbooks/legacy-office-conversion-runtime.md`、`apps/ingestion-worker/README.md` 与 `env/commands/legacy-office-conversion-service.env.example` 现已统一到同一条 operator/runtime contract。
  - `.tmp/phase-h-libreoffice-runtime-productization/` 已通过真实 authenticated notice source-bucket `.doc/.xls` 样本生成 evidence bundle。
- 当前 workstream 现已回到 completed 状态；`official_web` linked-file adoption、`authenticated_notice file_release`、semantic-image enrichment 与 regulation downstream 继续保持 deferred / out-of-scope，不由本线继续承接。

## Blockers

- None.

## Verification

- `uv run --all-packages python -m unittest tests.ingestion.test_legacy_office_conversion_client tests.ingestion.test_file_asset_substrate tests.ingestion.test_normalize_authenticated_notice_legacy_office_attachment_worker`
  - `24 tests OK`
- `docker build -f apps/legacy-office-conversion-service/Dockerfile --target unit-tests -t campus-legacy-office-conversion:test /home/reptilian/code/campus-agent`
  - `exit 0`
- `docker compose -f infra/local/docker-compose.legacy-office-conversion.yml up -d --build`
  - runtime booted successfully
- `curl -sS http://127.0.0.1:8091/healthz`
  - `{"status":"ok","engine_name":"jodconverter+libreoffice","engine_version":"LibreOffice 7.3.7.2 30(Build:2)"}`
- `curl -sS http://127.0.0.1:8091/readyz`
  - `{"engine_name":"jodconverter+libreoffice","engine_version":"LibreOffice 7.3.7.2 30(Build:2)","status":"ready"}`
- `LEGACY_OFFICE_CONVERSION_BASE_URL=http://127.0.0.1:8091 LEGACY_OFFICE_CONVERSION_INTERNAL_SHARED_SECRET=change-me uv run --all-packages python -m scripts.doctor_env ingestion --json`
  - `overall_ready=true`
- `uv run --all-packages campus-ingestion-normalize-authenticated-notice-legacy-office-attachment --help`
  - `exit 0`
- `LEGACY_OFFICE_CONVERSION_BASE_URL=http://127.0.0.1:8091 LEGACY_OFFICE_CONVERSION_INTERNAL_SHARED_SECRET=change-me uv run --all-packages python -m scripts.verify_legacy_office_conversion_runtime --output-dir .tmp/phase-h-libreoffice-runtime-productization --json`
  - real `.doc` + `.xls` evidence generated successfully
- `uv run --all-packages python -m unittest tests.ingestion.test_legacy_office_conversion_client tests.ingestion.test_file_asset_substrate tests.ingestion.test_normalize_authenticated_notice_legacy_office_attachment_worker tests.test_doctor_env tests.test_verify_legacy_office_conversion_runtime`
  - `38 tests OK`
- `docker compose -f infra/local/docker-compose.legacy-office-conversion.yml down`
  - service shutdown succeeded

## Session Continuity

**Stopped At:** `Phase H` 已完成；如未来 reopen，只在 repo-level file-like asset adoption、legacy Office runtime contract 或 deployment posture 再次发生结构性变化时恢复。
**Resume File:** `.planning/workstreams/shared-file-asset-loader-contract/ROADMAP.md`
