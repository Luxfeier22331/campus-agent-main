---
doc_type: phase_plan
workstream: shared-file-asset-loader-contract
phase: "H"
phase_name: "LibreOffice Conversion Runtime Productization"
plan: "03"
type: execute
wave: 2
status: active
autonomous: true
language: zh-CN
depends_on:
  - H-01
  - H-02
files_modified:
  - apps/ingestion-worker/pyproject.toml
  - apps/ingestion-worker/README.md
  - scripts/doctor_env.py
  - scripts/verify_legacy_office_conversion_runtime.py
  - env/commands/legacy-office-conversion-service.env.example
  - docs/architecture/system/file-asset-loader-architecture.md
  - docs/environment/README.md
  - docs/runbooks/legacy-office-conversion-runtime.md
requirements:
  - H3
  - H4
user_setup:
  - 提供 authenticated-notice 当前 source truth 中至少 1 个真实 `.doc` 与 1 个真实 `.xls` 附件。
  - 保证 `H-02` 新增的 service runtime 已启动，并可从当前环境访问。
must_haves:
  truths:
    - worker/operator/docs/env truth all point to the same `LEGACY_OFFICE_CONVERSION_*` runtime contract
    - doctor env treats the conversion seam as canonical ingestion readiness
    - real `.doc` and `.xls` closeout evidence is generated through the same worker/core path used in production
  artifacts:
    - env/commands/legacy-office-conversion-service.env.example
    - docs/runbooks/legacy-office-conversion-runtime.md
    - scripts/verify_legacy_office_conversion_runtime.py
    - .tmp/phase-h-libreoffice-runtime-productization/
  key_links:
    - runbook and docs reference the same service routes and env names implemented by H-01/H-02
    - verification helper exercises authenticated-notice real assets through the service-backed normalization path
created: 2026-04-20
updated: 2026-04-20
---

<objective>
收口 worker/env/docs/operator truth，并完成真实 `.doc/.xls` service-path closeout evidence。

Purpose: 让 H3/H4 不只停在代码结构收口，还把 operator contract、doctor readiness、真实资产验证和 runbook 一次对齐。
Output: 统一 env/docs/runbook、verification helper、真实资产 evidence bundle。
</objective>

<execution_context>
@$HOME/.codex/get-shit-done/workflows/execute-plan.md
@$HOME/.codex/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/workstreams/shared-file-asset-loader-contract/ROADMAP.md
@.planning/workstreams/shared-file-asset-loader-contract/STATE.md
@.planning/workstreams/shared-file-asset-loader-contract/phases/phase-h-libreoffice-conversion-runtime-productization/CONTEXT.md
@.planning/workstreams/shared-file-asset-loader-contract/phases/phase-h-libreoffice-conversion-runtime-productization/RESEARCH.md
@docs/architecture/system/file-asset-loader-architecture.md
@apps/ingestion-worker/README.md
@scripts/doctor_env.py
</context>

<tasks>

<task type="auto">
  <name>Task 1: 统一 worker/env/docs/operator contract</name>
  <files>apps/ingestion-worker/pyproject.toml, apps/ingestion-worker/README.md, scripts/doctor_env.py, env/commands/legacy-office-conversion-service.env.example, docs/architecture/system/file-asset-loader-architecture.md, docs/environment/README.md, docs/runbooks/legacy-office-conversion-runtime.md</files>
  <read_first>apps/ingestion-worker/pyproject.toml, apps/ingestion-worker/README.md, docs/environment/README.md, docs/architecture/system/file-asset-loader-architecture.md, scripts/doctor_env.py, .planning/workstreams/shared-file-asset-loader-contract/phases/phase-h-libreoffice-conversion-runtime-productization/RESEARCH.md</read_first>
  <action>在 `apps/ingestion-worker/pyproject.toml` 暴露稳定命令 `campus-ingestion-normalize-authenticated-notice-legacy-office-attachment`，并在 README 里明确 required env：`LEGACY_OFFICE_CONVERSION_BASE_URL`、`LEGACY_OFFICE_CONVERSION_INTERNAL_SHARED_SECRET`，optional env：`LEGACY_OFFICE_CONVERSION_TIMEOUT_SECONDS`。在 `scripts/doctor_env.py` 的 ingestion surface 增加 legacy Office conversion seam required settings。新增 `env/commands/legacy-office-conversion-service.env.example`，写出 caller/service 的 canonical defaults。更新 `docs/architecture/system/file-asset-loader-architecture.md`、`docs/environment/README.md`、`docs/runbooks/legacy-office-conversion-runtime.md` 与 `apps/ingestion-worker/README.md`，把 canonical endpoint 固定为 `POST /api/internal/legacy-office/conversions`，health routes 固定为 `GET /healthz` / `GET /readyz`，并明确 Phase H 不重开 OCR/provider-routing、`official_web` linked-file adoption、`authenticated_notice file_release`、regulation downstream、query-serving。</action>
  <verify>uv run --all-packages python -m scripts.doctor_env ingestion --json && uv run --all-packages campus-ingestion-normalize-authenticated-notice-legacy-office-attachment --help && rg -n \"LEGACY_OFFICE_CONVERSION_BASE_URL|LEGACY_OFFICE_CONVERSION_INTERNAL_SHARED_SECRET|/api/internal/legacy-office/conversions|/healthz|/readyz|x-app-internal-auth\" apps/ingestion-worker/README.md docs/environment/README.md docs/architecture/system/file-asset-loader-architecture.md docs/runbooks/legacy-office-conversion-runtime.md env/commands/legacy-office-conversion-service.env.example</verify>
  <acceptance_criteria>
    - worker README、environment docs、runbook、architecture doc 与 env example 使用同一组 env 名和 route
    - `doctor_env ingestion` 把 legacy Office conversion seam 当成 canonical ingestion readiness 的一部分
    - 文档中不再出现“本机装 soffice 即可完成 phase”或“worker 直接 shell out 也算 canonical”表述
  </acceptance_criteria>
  <done>H3 所需的 env/operator/docs truth 已统一到一条 service-backed runtime contract。</done>
</task>

<task type="auto">
  <name>Task 2: 新增 verification helper 并完成真实 `.doc/.xls` closeout evidence</name>
  <files>scripts/verify_legacy_office_conversion_runtime.py</files>
  <read_first>docs/runbooks/legacy-office-conversion-runtime.md, apps/ingestion-worker/src/campus_ingestion_worker/normalize_authenticated_notice_legacy_office_attachment.py, tests/ingestion/test_legacy_office_conversion_client.py, tests/ingestion/test_file_asset_substrate.py, tests/ingestion/test_normalize_authenticated_notice_legacy_office_attachment_worker.py</read_first>
  <action>新增 `scripts/verify_legacy_office_conversion_runtime.py`，让它能从 authenticated_notice current source truth 中选出至少 1 个真实 `.doc` 与 1 个真实 `.xls`，下载到 `.tmp/phase-h-libreoffice-runtime-productization/samples/`，探 `GET /healthz` 与 `/readyz`，再通过 worker/core normalization path 调用 service-backed seam，并落 `service-healthz.json`、`service-readyz.json`、`samples/manifest.json`、两份 `result.json`、两份 normalized OOXML、`SUMMARY.md`。`SUMMARY.md` 必须明确写出两个真实样本的 `source_object_key`、`source_sha256`、`normalized_sha256`、`target_format`、`engine_name`、`engine_version`，并注明样本都来自 authenticated_notice current source truth，而不是 repo 内伪造 fixture。证据跑完后再次执行 Python tests，证明 real-asset closeout 没把 contract regression 带回去。</action>
  <verify>uv run --all-packages python -m scripts.verify_legacy_office_conversion_runtime --help && docker compose -f infra/local/docker-compose.legacy-office-conversion.yml up -d --build && uv run --all-packages python -m scripts.verify_legacy_office_conversion_runtime --output-dir .tmp/phase-h-libreoffice-runtime-productization --json && uv run --all-packages python -m unittest tests.ingestion.test_legacy_office_conversion_client tests.ingestion.test_file_asset_substrate tests.ingestion.test_normalize_authenticated_notice_legacy_office_attachment_worker && bash -lc 'test -f .tmp/phase-h-libreoffice-runtime-productization/doc/result.json && test -f .tmp/phase-h-libreoffice-runtime-productization/xls/result.json && test -f .tmp/phase-h-libreoffice-runtime-productization/SUMMARY.md' && rg -n '\"engine_name\": \"jodconverter\\+libreoffice\"|source_object_key|normalized_sha256' .tmp/phase-h-libreoffice-runtime-productization/doc/result.json .tmp/phase-h-libreoffice-runtime-productization/xls/result.json .tmp/phase-h-libreoffice-runtime-productization/SUMMARY.md && docker compose -f infra/local/docker-compose.legacy-office-conversion.yml down</verify>
  <acceptance_criteria>
    - `.tmp/phase-h-libreoffice-runtime-productization/` 下存在 1 个真实 `.doc` 和 1 个真实 `.xls` 的 source 文件、normalized OOXML、结果 JSON 与汇总说明
    - 两个 `result.json` 都显示 engine truth 为 `jodconverter+libreoffice`，并包含正确的 `normalized_sha256`
    - evidence bundle 与 tests 一起证明 legacy Office canonical path 已完成 runtime productization
  </acceptance_criteria>
  <done>H4 所需的真实 `.doc/.xls` closeout evidence 已通过 repo-owned helper 固化下来。</done>
</task>

</tasks>

<verification>
Before declaring plan complete:
- [ ] `uv run --all-packages python -m scripts.doctor_env ingestion --json`
- [ ] `uv run --all-packages campus-ingestion-normalize-authenticated-notice-legacy-office-attachment --help`
- [ ] `uv run --all-packages python -m scripts.verify_legacy_office_conversion_runtime --help`
- [ ] `docker compose -f infra/local/docker-compose.legacy-office-conversion.yml up -d --build`
- [ ] `uv run --all-packages python -m scripts.verify_legacy_office_conversion_runtime --output-dir .tmp/phase-h-libreoffice-runtime-productization --json`
- [ ] `uv run --all-packages python -m unittest tests.ingestion.test_legacy_office_conversion_client tests.ingestion.test_file_asset_substrate tests.ingestion.test_normalize_authenticated_notice_legacy_office_attachment_worker`
</verification>

<success_criteria>

- H3 的 env/operator/docs truth 已与 service/runtime contract 一致
- H4 的真实 `.doc/.xls` evidence bundle 已落盘，并通过 repo-owned helper 可重复生成
- Phase H closeout 所需的 docs 与 validation lane 不再依赖手工口头说明
</success_criteria>

<output>
After completion, create `.planning/workstreams/shared-file-asset-loader-contract/phases/phase-h-libreoffice-conversion-runtime-productization/H-03-SUMMARY.md`
</output>
