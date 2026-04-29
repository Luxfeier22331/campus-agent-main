---
doc_type: requirements
status: active
created: 2026-04-29
updated: 2026-04-29
---

<!-- markdownlint-disable MD013 -->

# Requirements: Collected Notice Consumption Replay Closeout

## Problem

当前已经有一批 authenticated notice / file_release / WeChat 相关采集对象和部分 downstream 试验状态。
但这些状态混合了 source-truth import、projection、stage release、smoke release、manual review 与 partial OCR。

首期需要先把旧消费状态清干净，再基于完整链路设计做 dry-run reimport。否则无法判断哪些内容只是已采集，哪些已进入 source-truth，哪些真正进入下游消费。

## Goals

1. 保留已采集事实：source bucket 对象、collector run ledger、object locator evidence 不得被当作旧消费污染清除。
2. 清除旧消费事实：projection、read-model、OCR attempt、typed release/stage/current 等 derived state 必须可 dry-run、可备份、可审计地 reset。
3. 全量可检索：所有被 admission 为已采集有效通知的内容，都必须进入统一 searchable notice layer。
4. 分批 downstream：只有显式 consumer admission 的通知子集进入 `regulation`、`transport_schedule`、`service_status`。
5. OCR / 多模态默认纳入消费：图片、PDF、附件中的正文信息必须以 provenance 形式进入 searchable text 或 pending/failure 状态。
6. OCR / 多模态状态必须统一：schedule image OCR、internal notice multimodal、WeChat multimodal 不能长期保留三套互不兼容的 lifecycle / provenance 口径。
7. 每个阶段都能 dry-run：在正式写入前输出将写入、将删除、将跳过、将 defer 的 deterministic report。
8. 所有结果可回链：searchable row 与 downstream row 必须能回到 source notice URL、source object refs、run id、OCR/attachment provenance。

## Non-Goals

- 不处理定时采集和认证态刷新。
- 不新增抓取范围。
- 不把 file_release 自动伪装成 notice。
- 不把所有通知都自动进入结构化 downstream。
- 不绕过 explicit admission manifest。
- 不把 dry-run 当成写入路径。
- 不打开未设计好的 serving surface。

## Consumption Classes

每条已采集通知必须被分类为以下之一：

- `search_only`: 进入统一可检索层，但不进入结构化 downstream。
- `downstream_admitted`: 进入已设计好的下游 consumer。
- `defer`: 保留 source-truth 和 searchable metadata，等待未来设计。
- `needs_multimodal`: 文本不足或关键事实在图片/PDF/附件中，先进入 OCR/多模态 drain。
- `invalid_capture`: 采集对象缺失、hash/size 不一致、正文不可恢复或 provenance 不满足要求。

## Downstream Targets

首期允许的 downstream target 只有：

- `regulation`
  - 来源：规章制度、制度文件、长期或 scoped rule。
  - 不默认打开 query-serving；先完成 document holding / regulation candidate / gated materialization。
- `transport_schedule`
  - 来源：班车、交通时刻、运行安排、临时调整。
  - 图片和 PDF schedule 必须先有 OCR/结构化 evidence。
- `service_status`
  - 来源：浴室、图书馆、校园卡、平台、后勤、医院、IT 等状态型通知。
  - 只承接明确状态变化或临时开放/暂停/迁移类通知。

未进入上述 target 的通知仍应进入 searchable notice layer。

## Reset Contract

reset 必须满足：

- 默认 dry-run。
- 正式执行必须显式 `--yes` 或等价确认。
- reset 前输出 backup artifact。
- reset 不删除 source bucket 原始采集对象。
- reset 不删除 collector run ledger。
- reset 不删除 object locator audit evidence。
- reset 只删除或撤回 derived state：projection、read model、admission batch、OCR/multimodal attempt、typed downstream release/stage/current。
- reset 后数据库应表达 collected-but-not-consumed，而不是 source 丢失。

## Acceptance Criteria

- 可列出当前已采集对象、source-truth candidate、已消费污染项和 reset 范围。
- reset dry-run 与 execute report 数量一致，并能说明每个表的变化。
- reimport dry-run 不写 DB / object store / read model / downstream release。
- 全量 searchable layer 至少覆盖本批有效 captured notice。
- OCR/多模态 pending/done/failed 状态可被查询，且 linked 到 notice/attachment/media refs。
- 分散的 OCR/多模态 attempt 可以投影到统一 notice multimodal consumption ledger，并区分 provider response、normalized text/layout/table、searchable merge input 与 downstream readiness。
- `regulation`、`transport_schedule`、`service_status` 均有 batch manifest、dry-run report、stage/replay report 与 consistency check。
- 未 admission 的通知没有进入 typed downstream。
- 已 admission 的通知可追溯到 source object refs 与 consumer admission batch。
