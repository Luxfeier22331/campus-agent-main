---
doc_type: roadmap
status: completed
created: 2026-04-30
updated: 2026-04-30
---

<!-- markdownlint-disable MD013 -->

# Roadmap: Notice Ingest Fact State Machine

## Overview

本 roadmap 先建立 failure taxonomy 和 sample corpus，再冻结状态机 contract，最后改造 media role、fact readiness 和 target replay。
目标是把 `multimodal_not_ready` 从 notice-level hard gate 改成 fact-level blocker。

## Phase Status

- [x] **Phase 1: Failure Taxonomy And Sample Corpus** — 收集 schedule、service-status、regulation、WeChat/PDF、多媒体补充图样本，形成可复跑 fixture。
- [x] **Phase 2: State Machine Contract** — 冻结 source/media/fact/target 四层状态、transition、reason code、idempotency key 和 dry-run report schema。
- [x] **Phase 3: Media Role Classifier** — 实现媒体角色分类，让图片/附件区分 fact carrier、supplemental visual、QR/reservation instruction、unknown。
- [x] **Phase 4: Fact Completeness Gate** — 实现 text-first fact readiness，只有 required fact 缺失且 media 是 carrier 时才要求 OCR/multimodal。
- [x] **Phase 5: Target Replay Refactor** — 让 transport_schedule、service_status、regulation replay 消费 fact readiness，而不是直接消费 unit-level multimodal status。
- [x] **Phase 6: Evidence Replay And Acceptance** — 重放固定 corpus，证明 `355881` stage ready、`355867` OCR-primary、service-status/regulation 边界稳定。
- [x] **Phase 7: Guardrails And Closeout** — 增加防回流测试、rg/decomposition guard、docs/state closeout evidence。
- [x] **Phase 8: Source Retention Preview Audit And Integration** — 把 notice-first retention
  state machine 从人工验证推进到 source-truth / preview 输出，修正 legacy `process/no target`
  附件 bytes 误保留风险。
- [x] **Phase 9: Live Collector Fetch Admission** — 把 source retention 结果接入 live
  collector：默认 reference-only，只有显式 fetch request manifest admission 才下载附件 bytes，
  并让 run ledger required object verification 与 required/admitted owner bytes 对齐。

## Phase 1: Failure Taxonomy And Sample Corpus

**Goal:** 把已知误判和预期行为变成 corpus，而不是只口头修一个样本。

**Deliverables:**

- `FAILURE-TAXONOMY.md`
- `SAMPLE-CORPUS.md`
- `sample-corpus.json`
- `current-behavior-audit.json`
- `phase-01-summary.md`

**Required Samples:**

- `355881`: body-complete transport schedule with supplemental image.
- `355867`: schedule image carrier requiring OCR.
- `355122` / `355512`: existing transport replay examples from closeout evidence.
- service-status text-complete sample.
- service-status image/attachment-dependent sample.
- file-release regulation owner document sample.
- ordinary notice with image that must remain search-only.
- WeChat notice with images and real mp.weixin source refs.

**Verification:**

```bash
uv run --all-packages python -m unittest tests.ingestion.test_collected_notice_downstream_pilot -q
pnpm docs:lint
```

## Phase 2: State Machine Contract

**Goal:** 在改代码前冻结 source/media/fact/target 状态机和 reason code registry。

**Deliverables:**

- `NOTICE-INGEST-FACT-STATE-MACHINE.md`
- `STATE-SCHEMA.md`
- `REASON-CODES.md`
- `TRANSITION-MATRIX.md`
- `IDEMPOTENCY-POLICY.md`
- contract fixtures under `fixtures/`

**Verification:**

```bash
pnpm docs:lint
uv run --all-packages python -m unittest tests.ingestion.test_collected_notice_ingest_fact_state_contract -q
```

## Phase 3: Media Role Classifier

**Goal:** 让媒体 candidate 有角色，而不是只靠 pending/completed。

**Deliverables:**

- media role classifier module.
- media role report for Phase 1 corpus.
- tests covering schedule table carrier vs supplemental location visual.
- reason code mapping from classifier output to fact readiness.

**Verification:**

```bash
uv run --all-packages python -m unittest tests.ingestion.test_collected_notice_media_role_classifier -q
uv run --all-packages ruff check packages/ingestion-core tests/ingestion
uv run --all-packages ruff format packages/ingestion-core tests/ingestion --check
```

## Phase 4: Fact Completeness Gate

**Goal:** 先从 body / owner text / existing OCR 输出生成 fact readiness，再决定是否需要 OCR。

**Deliverables:**

- fact readiness module.
- target fact requirement registry for `transport_schedule`、`service_status`、`regulation`。
- text-first completeness gate.
- fact readiness evidence for corpus.

**Verification:**

```bash
uv run --all-packages python -m unittest tests.ingestion.test_collected_notice_fact_readiness -q
uv run --all-packages ruff check packages/ingestion-core tests/ingestion
```

## Phase 5: Target Replay Refactor

**Goal:** 下游 target replay 只消费 fact readiness / target admission，不再使用 unit-level media pending 作为硬阻断。

**Scope:**

- `transport_schedule`: `355881` 产出 7 条 text-primary rows；`355867` 保持 required media blocked/OCR-primary。
- `service_status`: 正文完整的服务状态通知可 stage；缺 required facts 的媒体承载通知 stay pending/review。
- `regulation`: owner document / owner text required gate 不降级。

**Verification:**

```bash
uv run --all-packages python -m unittest \
  tests.ingestion.test_collected_notice_downstream_pilot \
  tests.ingestion.test_collected_notice_service_status_downstream_replay \
  tests.ingestion.test_preview_collected_notice_regulation_admission_worker -q
```

## Phase 6: Evidence Replay And Acceptance

**Goal:** 用 corpus 重放证明状态机行为符合目标。

**Deliverables:**

- `fact-state-machine-replay.json`
- `transport-schedule-acceptance.json`
- `service-status-acceptance.json`
- `regulation-acceptance.json`
- `source-to-media-to-fact-to-target-trace.json`
- `acceptance-summary.json`

**Verification:**

```bash
uv run --all-packages python -m unittest discover -s tests/ingestion -t . -q
uv run --all-packages ruff check packages/ingestion-core apps/ingestion-worker tests/ingestion
uv run --all-packages ruff format packages/ingestion-core apps/ingestion-worker tests/ingestion --check
```

## Phase 7: Guardrails And Closeout

**Goal:** 防止 notice-level pending media hard gate 回流，并更新 workstream 状态。

**Deliverables:**

- drift guard test: `target + supplemental pending image` must not imply target blocked.
- rg guard or focused lint fixture against target replay reading `multimodal_status` as sole blocker.
- closeout `SUMMARY.md`
- updated `STATE.md` / `WORKSTREAMS.md`

**Verification:**

```bash
pnpm docs:lint
uv run --all-packages ruff check .
uv run --all-packages ruff format . --check
uv run --all-packages python -m unittest discover -s tests -t .
git diff --check
```

## Phase 8: Source Retention Preview Audit And Integration

**Goal:** 把 source retention 状态机落到 source-truth 与 collected notice reimport
preview，让附件 bytes 是否保留由 `notice_capture_route` 和 per-attachment policy 决定，而不是
沿用旧 `attachment_processing_policy=process`。

**Deliverables:**

- `authenticated_notice_source_retention_decision.py`
- source-truth `notice-manifest.json` retention summary fields
- source-truth `attachment-refs.jsonl` per-attachment capture / retention fields
- collected notice reimport preview `source_retention` summary
- metadata-only attachment source object ref filtering
- Batch 3 preview audit evidence for 83 legacy `process/no target` units

**Verification:**

```bash
uv run --all-packages python -m unittest \
  tests.ingestion.test_authenticated_notice_source_retention_decision \
  tests.ingestion.test_authenticated_notice_retention_preview_audit \
  tests.ingestion.test_authenticated_notice_routing_sampling \
  tests.ingestion.test_authenticated_notice_routing_taxonomy_eval \
  tests.ingestion.test_evaluate_authenticated_notice_routing_taxonomy_worker \
  tests.ingestion.test_collected_notice_reimport_preview \
  tests.ingestion.test_preview_collected_notice_reimport_worker \
  tests.ingestion.authenticated_notice_import_bundle_suite \
  tests.ingestion.authenticated_notice_import_inventory_suite
uv run --all-packages ruff check \
  packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_source_retention_decision.py \
  packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_source_truth_artifacts.py \
  packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_import.py \
  packages/ingestion-core/src/campus_ingestion_core/collected_notice_reimport_preview.py \
  tests/ingestion/test_authenticated_notice_source_retention_decision.py \
  tests/ingestion/test_collected_notice_reimport_preview.py \
  tests/ingestion/test_authenticated_notice_retention_preview_audit.py \
  tests/ingestion/test_authenticated_notice_routing_sampling.py \
  tests/ingestion/test_authenticated_notice_routing_taxonomy_eval.py
uv run --all-packages ruff format \
  packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_source_retention_decision.py \
  packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_source_truth_artifacts.py \
  packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_import.py \
  packages/ingestion-core/src/campus_ingestion_core/collected_notice_reimport_preview.py \
  tests/ingestion/test_authenticated_notice_source_retention_decision.py \
  tests/ingestion/test_collected_notice_reimport_preview.py \
  tests/ingestion/test_authenticated_notice_retention_preview_audit.py \
  tests/ingestion/test_authenticated_notice_routing_sampling.py \
  tests/ingestion/test_authenticated_notice_routing_taxonomy_eval.py --check
```

## Phase 9: Live Collector Fetch Admission

**Goal:** 把 Phase 8 source retention 决策从 source-truth / preview 推进到 collector live
行为，避免 collector 因配置了 object store 就自动下载所有内部附件或 allowlisted external inline
image。

**Deliverables:**

- collector `attachmentFetchAdmissions` contract。
- `AUTHENTICATED_NOTICE_ATTACHMENT_FETCH_REQUEST_MANIFEST_PATH` env entrypoint。
- ingestion-core `authenticated_notice_attachment_fetch_request_manifest_v1` builder。
- collector manifest parser from fetch request rows to admissions。
- run ledger required source object verification aligned to explicit required/admitted owner bytes。

**Verification:**

```bash
pnpm --dir apps/authenticated-notice-collector test -- bootstrap-export.test.ts config.test.ts portal.test.ts
pnpm --dir apps/authenticated-notice-collector typecheck
uv run --all-packages python -m unittest tests.ingestion.test_authenticated_notice_attachment_fetch_request_manifest -q
uv run --all-packages ruff check packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_attachment_fetch_request_manifest.py tests/ingestion/test_authenticated_notice_attachment_fetch_request_manifest.py
uv run --all-packages ruff format packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_attachment_fetch_request_manifest.py tests/ingestion/test_authenticated_notice_attachment_fetch_request_manifest.py --check
```
