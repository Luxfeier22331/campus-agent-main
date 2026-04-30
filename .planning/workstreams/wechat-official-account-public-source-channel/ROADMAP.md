---
doc_type: roadmap
status: completed
created: 2026-04-27
updated: 2026-04-30
---

# Roadmap: WeChat Official-Account Public Source Channel

## Overview

这条 workstream 已重开执行。Phase 1-6 仍保留为历史完成切片，但此前把 FeedWe
authenticated web article/detail/download surface 视为正文投影 owner 的 closeout
结论已被 live verification 推翻。当前路线图用于把主链恢复为
`FeedWe discovery -> real mp.weixin page capture -> canonical source-truth -> notice consumption`
并收口图片/OCR、replay 与 drift guard。

## Historical Phases

### Phase 1: Source Admission And FeedWe Provider Contract

**Status:** completed

**Goal:** 冻结 `wechat_official_account` source channel、FeedWe provider contract 与
notice-family owner 边界。

### Phase 2: Capture And App-api Control-plane Handoff

**Status:** completed

**Goal:** 通过现有 MinIO/file architecture 落 provider artifact、request summary、
run ledger 与 app-api control-plane handoff。

### Phase 3: WeChat Article Source-truth And Replay Contract

**Status:** completed

**Goal:** 冻结 provider-agnostic source-truth schema、identity/versioning 与 replay
contract。

### Phase 4: Notice Consumption Projection Opening

**Status:** completed

**Goal:** 打开 `wechat_public_notice` source family 与 notice consumption projection。

### Phase 5: Acceptance Evidence And Planning Closeout

**Status:** completed, superseded in part

**Goal:** 历史 closeout；其“FeedWe authenticated web response 足够作为正文 truth”的
结论已不再成立。

### Phase 6: Notice Source-family Serving Admission

**Status:** completed, superseded in part

**Goal:** 历史 serving admission；统一 notice-family 路线继续保留，但当前 queryable
precondition 需要在 Phase 10-11 重新硬化。

## Reopened Phases

### Phase 7: Reopen And Truth Correction

**Status:** completed

**Goal:** 撤回错误 closeout，统一 planning truth、runtime truth 与 source-truth truth。

**Scope:**

- 更新 workstream README / ROADMAP / STATE / REQUIREMENTS 与 repo registry
- 记录 live verification 结论：
  - FeedWe article detail page 是摘要页
  - `/api/articles/{id}` 仅返回 metadata/summary
  - `/api/articles/download` 与 `/api/articles/download-local` 对样本返回占位 HTML
  - Mozilla-style request 可抓到真实 `mp.weixin` 页面
- 明确 accepted primary chain:
  `FeedWe discovery -> real mp.weixin page capture -> canonical source-truth`
- 撤回“FeedWe download/export 是正文投影 owner”的叙述

### Phase 8: Discovery-To-Page Capture Pipeline

**Status:** completed

**Goal:** 把 collector 主链从“FeedWe 直接物化 source-truth”改成“两段式采集”。

**Scope:**

- FeedWe 登录、订阅解析、文章列表继续只做 discovery metadata
- 对每条文章以 `article.url` 为 primary fetch target 发起真实 `mp.weixin` 页面抓取
- 固定 browser-profile request posture：
  - `Mozilla` user-agent
  - `Accept: text/html,application/xhtml+xml`
  - `Accept-Language`
  - redirect follow
- 写入 capture artifacts：
  - `capture/wechat-article-fetch-metadata.json`
  - `capture/wechat-article-page.html`
- collector summary 新增 page capture 成功/失败统计

### Phase 9: Parser Hardening And Fail-Closed Body Semantics

**Status:** completed

**Goal:** 稳定解析真实 `mp.weixin` 页面，并对异常页 fail-close。

**Scope:**

- 强化 `wechat-article-page.ts`：
  - 验证页 / 环境异常页检测
  - 正文容器缺失检测
  - 标题、发布时间、正文段落、cover、inline image URL 提取
- 用真实 captured page 驱动 source-truth builder
- 显式区分：
  - `captured`
  - `fetch_failed`
  - `not_captured`
- 保证 FeedWe summary 只作为 fallback metadata，不再冒充正文

### Phase 10: Notice Consumption Gate Re-hardening

**Status:** completed

**Goal:** 恢复“只有真实采集完成的文章才可进入 queryable notice”。

**Scope:**

- projection 只消费 source-truth，不再读取 FeedWe raw summary / download payload
- queryable 前提收紧为：
  - `bodyState = captured`
  - 存在真实正文块，或存在后续可 OCR 的图片派生输入
- metadata-only / fetch-failed 条目只保留 audit/reference row
- 撤回此前误把摘要型条目当成完整正文进行 serving 的行为

### Phase 11: Image/OCR Default-On For WeChat Notice

**Status:** completed

**Goal:** 解决公众号通知中“关键信息在图片里”的默认路径。

**Scope:**

- `media-refs` 中的 `inline_image` 进入默认图片派生队列
- WeChat notice 默认开启 OCR
- OCR 结果作为 notice projection 的派生输入，不写回 source-truth schema
- 记录图片抓取/OCR 成功与失败状态，禁止 silent partial
- 对“详情见上图”类通知，未完成 OCR 前保持 non-queryable

### Phase 12: Replay, Drift Guard, And Acceptance Closeout

**Status:** completed

**Goal:** 为重开后的链路补齐 replay、live smoke 与防回流保护。

**Scope:**

- fixtures：
  - FeedWe discovery payload
  - real `mp.weixin` HTML
  - verify/captcha HTML
- replay validator 覆盖 source-truth 重建
- projection metadata / reproject flow 统一写入 `consumer_admission_batch_id`
- 新增 runtime smoke，显式校验：
  - source-truth object completeness
  - admission provenance completeness
  - read-model consistency
  - queryable body gate
  - pending multimodal attempt/image posture
- 新增 historical state audit 与 explicit purge CLI，支持历史坏数据 repair selection
- 统一 `scripts/run-wechat-public-notices.sh` 为：
  `project -> optional multimodal drain -> runtime smoke`
- drift guard：禁止重新把 FeedWe summary/download placeholder 当正文 truth
- live smoke 作为显式 lane，单独验证真实采集与 notice projection
- 更新 acceptance evidence 与 closeout 条件

**Closeout evidence:**

- `phases/phase-12-replay-drift-guard-and-acceptance-closeout/SUMMARY.md`
- `evidence/phase-12-replay-drift-guard-and-acceptance-closeout/live-capture-three-decoded-20260430070701.json`
- `evidence/phase-12-replay-drift-guard-and-acceptance-closeout/unified-shell-live-20260430070843.log`
- `evidence/phase-12-replay-drift-guard-and-acceptance-closeout/runtime-smoke-provider-check-20260430071654.json`
- `evidence/phase-12-replay-drift-guard-and-acceptance-closeout/state-audit-after-live-20260430071624.json`

## Guardrails

- FeedWe discovery provider 永远不是 canonical body owner。
- `mp.weixin` 页面抓取失败时必须 fail-close，不得回退到伪正文。
- WeChat notice 不得新建独立 query runtime；继续走统一 notice family。
- OCR 是 notice projection 的派生能力，不是 source-truth schema 字段。
- query-time runtime 不得回读 live FeedWe 或 live `mp.weixin` 页面。
