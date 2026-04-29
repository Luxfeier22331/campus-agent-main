---
doc_type: index
status: active
created: 2026-04-29
updated: 2026-04-29
---

<!-- markdownlint-disable MD013 -->

# Workstream: Collected Notice Consumption Replay Closeout

本 workstream 负责把当前已经采集到对象存储 / run ledger 的通知，重新收口为可验证的首期消费链路。

首期目标不是定时调度、认证续期或新的采集能力；这些由其他团队或其他 workstream 承接。
本线只处理已经采集到的内容如何被清理、重放、索引、OCR/多模态处理，并按显式 admission 分批进入下游消费。

## Target Shape

目标链路固定为：

`captured source objects + collector run ledger -> reset derived state -> dry-run import plan -> source-truth / document holding -> universal searchable notice layer -> consumer admission batches -> regulation / schedule / status downstream replay`

两条消费路径必须同时成立：

- 全量已采集通知进入统一可检索层：能按标题、正文、附件、图片/OCR 文本、来源 URL 与 provenance 被检索和回链。
- 只有显式 admission 的子集分批进入已设计好的结构化下游：`regulation`、`transport_schedule`、`service_status`；未设计好的内容停留在可检索层或 defer 状态。

## Current Baseline

截至 2026-04-29，本机 shared PG 观察到的状态：

- collector run ledger：`76` 条。
- source-truth inventory：
  - `campus_notices/internal_notice`: `308` 条。
  - `authenticated_documents/common_download_source`: `22` 条。
- file release inventory：
  - `authenticated_documents/file_release_source`: `56` 条。
  - `campus_notices/file_release_capture`: `56` 条。
- downstream projection/read model：
  - `notice_consumption_projection`: `68` 行。
  - `internal_notice_read_model`: `0` 行。
  - `internal_notice_schedule_image_ocr_attempt`: `13` 条 stored。
  - `internal_notice_multimodal_attempt`: `0` 条。
  - `wechat_public_notice_multimodal_attempt`: `0` 条。
- typed downstream：
  - `service_status_read_model`: `11` 行。
  - `service_guide_read_model`: `33` 行。
  - `transport_release_notices`: `218` 行。

这说明 object-native 采集 / holding 基础已经存在，但首期“全量可检索 + 分批进入下游”的消费链路还没有干净重放。

## Owned Scope

- 当前已采集内容的只读盘点和 reset manifest。
- 清除旧 derived/downstream state，恢复到 collected-but-not-consumed 状态。
- dry-run reimport 计划与 no-write 证明。
- 全量通知可检索层的最小 contract、projection/read-model 与一致性检查。
- OCR / 多模态文本进入可检索层的 admission、attempt、provenance 和 retry 状态。
- `regulation`、`transport_schedule`、`service_status` 三类首期下游的分批 replay plan、manifest 和 acceptance gate。
- closeout evidence：每批输入、dry-run、reset、replay、projection、read-model、OCR 与 downstream 结果必须可追溯。

## Non-Owned Scope

- 定时调度、cron / systemd / Kubernetes Job。
- authenticated portal 认证续期、cookie rotation、SSO 自动刷新。
- 新抓取任务、扩展 notice type、FeedWe / mp.weixin acquisition provider 选择。
- 打开新的 public query-serving surface。
- 新建未设计好的 downstream domain。
- 修改 `notice-consumption-layer` 已冻结的基础 projection schema，除非本线发现真实 drift 并明确记录。

## Native Planning Truth

- requirements: `./REQUIREMENTS.md`
- roadmap: `./ROADMAP.md`
- state: `./STATE.md`
- phase plans: `./phases/*/PLAN.md`
