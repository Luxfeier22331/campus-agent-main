---
doc_type: index
status: completed
created: 2026-04-30
updated: 2026-04-30
---

<!-- markdownlint-disable MD013 -->

# Workstream: Notice Ingest Fact State Machine

本 workstream 负责把 collected notice 的 ingest / OCR / downstream replay 从
notice-level 粗粒度 gating 收口为 fact-level 状态机。

Completed on 2026-04-30.

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
