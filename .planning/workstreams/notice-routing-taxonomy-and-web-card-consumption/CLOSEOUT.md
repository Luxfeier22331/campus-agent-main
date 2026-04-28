---
doc_type: closeout
status: completed
created: 2026-04-28
updated: 2026-04-28
---

# Closeout: Notice Routing Taxonomy And Web Card Consumption

## Completed Scope

- 首期 dedicated downstream denominator 固定为 regulation、schedule、
  service_status。
- Procurement、lecture、activity、publicity、campus-news、meeting/training、
  staff/internal-admin 等非首期 downstream family 进入
  `notice_level_query` generic title/url card。
- Generic-card-only family 使用 `machine_processing_policy=skip`，附件只保留
  metadata，不进入 OCR/VLM backlog。
- Projection 不再为采购标题额外生成 `procurement_notice_history` sidecar，也不再为
  lecture/activity generic card 额外生成 no-adoption sidecar。
- Notice runtime shared contract、notice-agent HTTP adapter 与 Go structured query
  runtime 已贯通 `target_surface`。
- `campus_notice_discover` 对缺最小 Web card 字段的 read-model row fail-close；
  `canonical_url` 为空时回退 `source_url`。

## Verification

- `uv run --all-packages python -m unittest tests.ingestion.authenticated_notice_notice_family_config_suite tests.ingestion.test_authenticated_notice_routing_sampling tests.ingestion.test_internal_notice_consumer_admission_builder tests.ingestion.authenticated_notice_notice_family_classification_suite tests.ingestion.internal_notice_consumption_projection_core_suite tests.ingestion.test_authenticated_notice_routing_taxonomy_eval tests.ingestion.test_evaluate_authenticated_notice_routing_taxonomy_worker tests.ingestion.test_internal_notice_read_model tests.ingestion.test_rebuild_internal_notice_read_model_worker tests.ingestion.test_internal_notice_pipeline_quality -v`
- `uv run --all-packages python -m unittest tests.contracts.contract_models_services_and_notice_suite tests.agent.test_notice_agent tests.ingestion.test_internal_notice_read_model -v`
- `go test ./internal/structuredquery`
- `uv run --all-packages ruff check ...`
- `uv run --all-packages ruff format --check ...`
- `pnpm docs:lint`
- `git diff --check`

## Reopen Rule

Only reopen this workstream if product scope promotes procurement into a dedicated
facet/history surface, a new dedicated notice downstream family is admitted, or
real-entry acceptance finds drift from the generic notice title/url card contract.

