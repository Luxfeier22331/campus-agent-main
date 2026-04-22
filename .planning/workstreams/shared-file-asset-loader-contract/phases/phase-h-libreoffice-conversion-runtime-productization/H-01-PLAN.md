---
doc_type: phase_plan
workstream: shared-file-asset-loader-contract
phase: "H"
phase_name: "LibreOffice Conversion Runtime Productization"
plan: "01"
type: execute
wave: 1
status: active
autonomous: true
language: zh-CN
depends_on: []
files_modified:
  - packages/ingestion-core/src/campus_ingestion_core/legacy_office_conversion_client.py
  - packages/ingestion-core/src/campus_ingestion_core/file_asset_legacy_office.py
  - apps/ingestion-worker/src/campus_ingestion_worker/normalize_authenticated_notice_legacy_office_attachment.py
  - tests/ingestion/test_legacy_office_conversion_client.py
  - tests/ingestion/test_file_asset_substrate.py
  - tests/ingestion/test_normalize_authenticated_notice_legacy_office_attachment_worker.py
requirements:
  - H1
  - H2
must_haves:
  truths:
    - legacy Office canonical conversion is invoked through an internal HTTP client instead of local `soffice`
    - missing env, transport failures, and invalid responses fail-close without CLI fallback
    - `.doc` and `.xls` normalization outcomes still preserve descriptor/provenance/artifact semantics
  artifacts:
    - packages/ingestion-core/src/campus_ingestion_core/legacy_office_conversion_client.py
    - tests/ingestion/test_legacy_office_conversion_client.py
  key_links:
    - file_asset_legacy_office.py calls legacy_office_conversion_client.py
    - worker shell still delegates directly to ingestion-core rather than owning HTTP retry/fallback logic
created: 2026-04-20
updated: 2026-04-20
---

<objective>
冻结 legacy Office conversion client seam，并把 `packages/ingestion-core` / `apps/ingestion-worker` 从 worker-direct `soffice --convert-to` canonical path 迁出。

Purpose: 先把 H1/H2 的 shared contract 与 fail-close behavior 固定下来，再让后续 service runtime 和 operator closeout 有稳定调用面。
Output: typed conversion client、重写后的 core/worker 调用链，以及对应 regression tests。
</objective>

<execution_context>
@$HOME/.codex/get-shit-done/workflows/execute-plan.md
@$HOME/.codex/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/workstreams/shared-file-asset-loader-contract/ROADMAP.md
@.planning/workstreams/shared-file-asset-loader-contract/phases/phase-h-libreoffice-conversion-runtime-productization/CONTEXT.md
@.planning/workstreams/shared-file-asset-loader-contract/phases/phase-h-libreoffice-conversion-runtime-productization/RESEARCH.md
@.planning/workstreams/shared-file-asset-loader-contract/phases/phase-h-libreoffice-conversion-runtime-productization/PATTERNS.md
@docs/architecture/system/file-asset-loader-architecture.md
@packages/ingestion-core/src/campus_ingestion_core/file_asset_legacy_office.py
@apps/ingestion-worker/src/campus_ingestion_worker/normalize_authenticated_notice_legacy_office_attachment.py
@apps/ingestion-worker/src/campus_ingestion_worker/official_web_handoff_consumer.py
@tests/ingestion/test_file_asset_substrate.py
@tests/ingestion/test_normalize_authenticated_notice_legacy_office_attachment_worker.py
</context>

<tasks>

<task type="auto">
  <name>Task 1: 新增 typed legacy Office conversion client</name>
  <files>packages/ingestion-core/src/campus_ingestion_core/legacy_office_conversion_client.py, tests/ingestion/test_legacy_office_conversion_client.py</files>
  <read_first>.planning/workstreams/shared-file-asset-loader-contract/phases/phase-h-libreoffice-conversion-runtime-productization/RESEARCH.md, .planning/workstreams/shared-file-asset-loader-contract/phases/phase-h-libreoffice-conversion-runtime-productization/PATTERNS.md, apps/ingestion-worker/src/campus_ingestion_worker/official_web_handoff_consumer.py</read_first>
  <action>新增 `legacy_office_conversion_client.py`，定义 typed request/response dataclass、repo-owned transport error 与 `build_legacy_office_conversion_client_from_env()`。caller 只向 `POST ${LEGACY_OFFICE_CONVERSION_BASE_URL}/api/internal/legacy-office/conversions` 发送 JSON，header 固定 `content-type: application/json` 与 `x-app-internal-auth`。`LEGACY_OFFICE_CONVERSION_TIMEOUT_SECONDS` 成为 caller timeout。缺少 base URL/shared secret、网络错误、HTTP 非 2xx、response JSON parse failure、hash mismatch、missing bytes、unsupported media type 全部 fail-close。同步新增 `tests/ingestion/test_legacy_office_conversion_client.py`，覆盖 success、401/403、503、timeout、response hash mismatch、response missing bytes。</action>
  <verify>uv run --all-packages python -m unittest tests.ingestion.test_legacy_office_conversion_client</verify>
  <acceptance_criteria>
    - 新 client 明确使用 `LEGACY_OFFICE_CONVERSION_BASE_URL`、`LEGACY_OFFICE_CONVERSION_INTERNAL_SHARED_SECRET`、`LEGACY_OFFICE_CONVERSION_TIMEOUT_SECONDS`
    - success payload 至少验证 `target_format`、`normalized_media_type`、`normalized_sha256`、`normalized_bytes_b64`、`engine_name`、`engine_version`
    - contract breach 和 transport failure 都映射成 repo-owned fail-close 错误
  </acceptance_criteria>
  <done>typed conversion client 与其 fail-close tests 已落盘，可作为 Phase H 唯一 canonical caller seam。</done>
</task>

<task type="auto">
  <name>Task 2: 把 core/worker canonical path 切到 service client</name>
  <files>packages/ingestion-core/src/campus_ingestion_core/file_asset_legacy_office.py, apps/ingestion-worker/src/campus_ingestion_worker/normalize_authenticated_notice_legacy_office_attachment.py, tests/ingestion/test_file_asset_substrate.py, tests/ingestion/test_normalize_authenticated_notice_legacy_office_attachment_worker.py</files>
  <read_first>packages/ingestion-core/src/campus_ingestion_core/file_asset_legacy_office.py, apps/ingestion-worker/src/campus_ingestion_worker/normalize_authenticated_notice_legacy_office_attachment.py, tests/ingestion/test_file_asset_substrate.py, tests/ingestion/test_normalize_authenticated_notice_legacy_office_attachment_worker.py</read_first>
  <action>重写 `file_asset_legacy_office.py`，保留 descriptor / provenance / artifact refs / normalized OOXML downstream extraction 逻辑，但移除 `shutil.which(\"soffice\")`、`subprocess.run()`、`_read_soffice_version()` 这条 lifecycle，改为通过新 client 获取 normalized bytes，并把 conversion engine truth 固定为 `jodconverter+libreoffice`。同步重写 `normalize_authenticated_notice_legacy_office_attachment.py`，保持它仍是薄 runtime shell，只做 env bootstrap、CLI args -> core call、JSON 输出；不要把 HTTP retry / fallback / office lifecycle 放回 worker。更新 substrate/worker tests，确保 `.doc -> .docx`、`.xls -> .xlsx` 的 normalization outcome 仍保留现有 `descriptor`、`normalized_sha256`、`artifact_refs`、`normalized_extension` 语义，并且缺失 service env 或 service 不可达时明确 fail-close。</action>
  <verify>uv run --all-packages python -m unittest tests.ingestion.test_file_asset_substrate tests.ingestion.test_normalize_authenticated_notice_legacy_office_attachment_worker && bash -lc '! rg -n \"shutil\\.which\\(|subprocess\\.run\\(|--convert-to\" packages/ingestion-core/src/campus_ingestion_core/file_asset_legacy_office.py apps/ingestion-worker/src/campus_ingestion_worker/normalize_authenticated_notice_legacy_office_attachment.py'</verify>
  <acceptance_criteria>
    - core/worker canonical path 不再直接出现 `shutil.which(\"soffice\")`、`subprocess.run(` 或 `--convert-to`
    - 缺少 `LEGACY_OFFICE_CONVERSION_BASE_URL` / `LEGACY_OFFICE_CONVERSION_INTERNAL_SHARED_SECRET` 时，normalization 明确抛出 repo-owned failure
    - extraction path 继续保留 legacy Office normalization + downstream OOXML parse 的 provenance 链接
  </acceptance_criteria>
  <done>ingestion-core 与 worker shell 已完全切到 service-backed client，H2 的 canonical path 迁移完成。</done>
</task>

</tasks>

<verification>
Before declaring plan complete:
- [ ] `uv run --all-packages python -m unittest tests.ingestion.test_legacy_office_conversion_client`
- [ ] `uv run --all-packages python -m unittest tests.ingestion.test_file_asset_substrate tests.ingestion.test_normalize_authenticated_notice_legacy_office_attachment_worker`
- [ ] `bash -lc '! rg -n "shutil\\.which\\(|subprocess\\.run\\(|--convert-to" packages/ingestion-core/src/campus_ingestion_core/file_asset_legacy_office.py apps/ingestion-worker/src/campus_ingestion_worker/normalize_authenticated_notice_legacy_office_attachment.py'`
</verification>

<success_criteria>

- H1 的 caller contract 已冻结为 internal HTTP client，而不是 local CLI
- H2 的 core/worker canonical path 已切到 service seam
- fail-close behavior 与 normalization/provenance semantics 都由 regression tests 守住
</success_criteria>

<output>
After completion, create `.planning/workstreams/shared-file-asset-loader-contract/phases/phase-h-libreoffice-conversion-runtime-productization/H-01-SUMMARY.md`
</output>
