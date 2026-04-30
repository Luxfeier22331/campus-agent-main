---
doc_type: index
status: completed
created: 2026-04-30
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Workstream: Notice Ingest Fact State Machine

本 workstream 负责把 collected notice 的 ingest / OCR / downstream replay 从
notice-level 粗粒度 gating 收口为 fact-level 状态机。

Completed on 2026-04-30. Reopened on 2026-04-30 for source-retention cleanup, then
closed after Phase 8.

触发问题是 `355881`（`关于开通丰台校区社会实践专车的通知`）：正文已经包含完整班次事实，但因为 notice
存在 pending inline image，当前 replay 把整条通知标记为 `multimodal_not_ready`，导致 7 条可从正文提取的
schedule rows 没有进入 target stage。正确边界是：target admission 应取决于目标所需事实是否 ready，而不是整条
notice 是否还有未处理媒体。

## Target Shape

目标链路固定为：

`notice_ingest job -> source/searchable unit -> media role state -> fact readiness state -> target admission state -> downstream replay`

四层状态分工：

- `source_unit_state`：描述 capture / queue / source-truth / searchable / replay evaluation 进度。
- `media_state`：描述图片、PDF、附件是否承载目标事实，以及 OCR / multimodal 是否 ready。
- `fact_readiness_state`：描述某个 target 所需事实来自正文、OCR、附件 owner text、混合来源还是仍缺失。
- `target_admission_state`：描述 target 是否 `stage_ready`、`search_only`、`needs_multimodal`、`defer`、`manual_review` 或
  `blocked`。

关键原则：

- 正文先行：先跑 text extraction / owner-text extraction，再判断是否需要 OCR。
- 媒体按角色阻断：pending media 只阻断它承载的 fact group，不阻断已完整的 text-derived facts。
- target 显式 admission：`transport_schedule`、`service_status`、`regulation` 各自消费同一 fact readiness contract。
- all captured valid notices 仍必须进入 searchable；未 admission 的 target 只停在 searchable / review / defer。
- dry-run 默认不写 DB、object store、release 或 current truth。

## Current Failure Mode

当前代码事实：

- `packages/ingestion-core/src/campus_ingestion_core/collected_notice_downstream_pilot.py`
  在 `_rejection_reason_codes()` 中使用 unit-level `multimodal_status` 阻断 transport schedule admission。
- `packages/ingestion-core/src/campus_ingestion_core/collected_notice_transport_baseline_policy.py`
  中 `requires_schedule_image_ocr()` 对 `transport_schedule + pending image` 过宽，未区分图片是 schedule table carrier
  还是 supplemental location visual。
- `355881` 的 body extraction 可直接产出 7 rows，因此它应成为本线的 primary regression fixture。

## Design Inputs

外部资料只作为设计参考，不引入外部 workflow runtime：

- AWS Step Functions best practices:
  `https://docs.aws.amazon.com/step-functions/latest/dg/sfn-best-practices.html`
- Google Cloud Workflows retry syntax and idempotency guidance:
  `https://docs.cloud.google.com/workflows/docs/reference/syntax/retrying`
- Temporal durable execution documentation:
  `https://docs.temporal.io/`
- Enterprise Integration Patterns Idempotent Receiver:
  `https://www.enterpriseintegrationpatterns.com/patterns/messaging/IdempotentReceiver.html`

Repo 选择：首期不引入 Temporal / Step Functions / Kafka。先把 repo-internal state projection、reason codes、
idempotency key、dry-run evidence 和 target admission contract 做确定，避免在错误状态模型上引入基础设施。

## Owned Scope

- collected notice ingest replay 的 source/media/fact/target 状态机 contract。
- media role classifier：区分 schedule table carrier、supplemental location visual、visual text only、QR/reservation
  instruction、unknown。
- fact completeness gate：先消费正文 / owner text，再决定是否需要 OCR / multimodal。
- `transport_schedule` target replay 的 fact-level admission 修复。
- `service_status` target replay 对 fact readiness 的消费。
- `regulation` owner-text / document-derived fact readiness 对齐。
- sample corpus、failure taxonomy、reason code registry、acceptance evidence。
- 防回流 guard：禁止 `target + pending image => target blocked` 的粗粒度 gating 回归。

## Non-Owned Scope

- 定时调度、认证续期、collector live rollout。
- 新增 source provider 或更改 FeedWe / mp.weixin acquisition 主链路。
- 打开新的 public query-serving surface。
- 引入外部 workflow runtime、Kafka、Temporal 或 Step Functions。
- prompt/provider/OCR 模型实现本身。
- 改写 `notice_ingest` queue durable store 基础语义；本线只消费和补充 replay state。

## Native Planning Truth

- requirements: `./REQUIREMENTS.md`
- roadmap: `./ROADMAP.md`
- state: `./STATE.md`
- phase plans: `./phases/*/PLAN.md`

## Phase 8 Addendum

Phase 8 closed the retention-state-machine gap found during larger notice sampling:
legacy `attachment_processing_policy=process` rows without admitted downstream target
must not force attachment byte retention.

Implemented outcome:

- added a notice-first source retention decision model;
- wrote `notice_capture_route` and attachment retention policy fields into notice
  source-truth artifacts;
- exposed `source_retention` in collected notice reimport preview;
- filtered `source_object_refs` so metadata-only attachments are not planned as
  required source objects;
- added preview audit evidence for 83 legacy `process/no target` units.

## Phase 9 Addendum

Phase 9 moved retention cleanup into live collector behavior:

- notice collector defaults to reference-only attachment rows even when object storage is configured;
- attachment bytes are downloaded only from explicit fetch admissions;
- ingestion-core emits `authenticated_notice_attachment_fetch_request_manifest_v1` rows for quarantine, source-truth-required, and admitted-owner fetches;
- collector can read the fetch request manifest via `AUTHENTICATED_NOTICE_ATTACHMENT_FETCH_REQUEST_MANIFEST_PATH`;
- run ledger required object verification now fails closed for required/admitted owner bytes and does not count quarantine bytes as required source objects.

## Post-Completion Hardening Addendum

The collect -> ingest state-machine review closed the remaining attachment-level
fail-closed gaps:

- collector now emits typed `last_error_class` for terminal unavailable and retryable
  transient attachment failures;
- source retention preserves retryable missing bytes as
  `attachment_capture_state=transient_failed` with `byte_fetch_required=true`;
- state-machine audit binds candidates to the referenced `media_ref_id` /
  `attachment_ref_id` instead of applying unit-level candidates to every attachment;
- fetch-required refs without bytes must have a manifest request or produce a high
  audit finding;
- `source_capture_repair` candidates require a media ref and closure by fetch request
  or operator action;
- candidate `source_object_ref` must match the referenced attachment's object-backed bytes.

## Collect -> Ingest Repair Loop Addendum

The follow-up repair loop regenerated current collect-to-ingest dry-run evidence and
closed the stale `file_release` preview gap:

- historical `file_release` preview artifacts could contain bucket / object-key / hash /
  size source-byte evidence while omitting `storage_provider` and `ingest_status`;
- ingest still treats stale object refs as unavailable unless they have provider/status,
  but the `file_release` source-ref preview now normalizes this historical
  object-backed shape to `object_store` + `uploaded`;
- this normalization is limited to `file_release` released source bytes and does not
  loosen generic notice attachment byte checks;
- regenerated preview/candidate/audit evidence covers 338 units and 60 media
  candidates with zero state-machine findings.

## Phase 10 Addendum

Phase 10 extends the state machine past candidate generation into media closeout and
target admission gating:

- added `notice_media_extraction_attempt_ledger.v1` as the normalized dry-run attempt
  projection for schedule image OCR, released-file text extraction, PDF OCR and office
  text extraction;
- added `notice_media_closeout_target_admission_state_machine_audit.v1` to verify
  attempt ledger presence, retry budget / next retry time, completed output refs,
  manual / terminal reason fields, target admission blockers, cleanup blockers and
  candidate source-object verification;
- added worker CLIs to build the attempt ledger and run the media closeout state-machine
  audit;
- regenerated the current 60-candidate media closeout evidence with planned closeout
  and source-object verification; audit findings are zero.

## Phase 11 Addendum

Phase 11 tightens the Phase 10 audit into a fail-closed full gate:

- strict gate now requires attempt ledger, closeout candidate inventory, target admission
  manifest, cleanup dry-run report and source-object verification report; missing inputs
  fail with high findings;
- attempt rows must belong to candidate inventory and match candidate media ref plus
  source object bucket/key/hash;
- completed closeout must carry output refs and attempt provenance;
- target admission manifest must cover every media candidate unit and cannot mark
  nonterminal target blockers ready;
- cleanup dry-run must explicitly protect active blocking quarantine bytes;
- source-object verification must match bucket/key/hash/size/storage provider, not just
  object key;
- on-demand authenticated-notice closeout can run the media gate before promotion when
  media gate evidence paths are supplied;
- regenerated current 60-candidate strict full-gate evidence reports zero findings.

## Phase 12 Addendum

Phase 12 closes the remaining medium/high bypass paths found by the collect -> ingest
repair loop:

- authenticated-notice closeout promotion now requires media gate evidence paths;
- worker media audit CLI no longer exposes a partial-gate escape hatch;
- source-object verification requires hash/checksum and byte size, not just verified status;
- completed closeout attempt provenance must match a completed attempt;
- target admission rows must match candidate target/source context;
- cleanup protection compares bucket/key identity instead of key-only identity;
- closeout candidate projection preserves attempt provenance from result manifests;
- regenerated current 60-candidate strict full-gate evidence reports zero findings.

## Phase 13 Addendum

Phase 13 closes the remaining productionization gaps around live source-object truth and
destructive/promotion bypasses:

- added `notice_media_source_object_verification_report.v1` generation from live
  object-store HEAD checksum, or controlled GET hash when HEAD lacks checksum;
- strict media audit now rejects source-object verification rows that lack
  `check_method=head_checksum|get_hash` or `live_checked_at`;
- direct authenticated-notice closeout promotion now requires a passed strict media gate
  audit, not only the on-demand batch wrapper;
- on-demand closeout can generate the live source-object verification report when only a
  candidate inventory is supplied for the media gate;
- destructive quarantine cleanup now requires a passed strict media gate audit and checks
  `input_hashes.candidate_inventory_sha256` against the cleanup candidate inventory;
- target admission rows mapped to media candidate units must carry `fact_readiness_state`
  and `required_fact_groups`.
