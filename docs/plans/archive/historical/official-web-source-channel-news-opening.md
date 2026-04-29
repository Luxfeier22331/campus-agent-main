---
doc_type: plan
status: historical
created: 2026-04-18
updated: 2026-04-22
---

# Official Web Source Channel And News Opening

## 文档边界

本文固定 `official-web source channel / news opening` 这条 backlog workstream。

它负责：

- `official_web` source-channel / control-plane follow-up
- `official_web/stable_reference` 的持续维护与证据连续性
- `official_web/fresh_news` opening
- `official_web/news_archive` opening

它不负责：

- 直接把 `fresh_news` 或 `news_archive` 写成已 reopened 的默认 surface
- 把 `stable_reference`、`fresh_news`、`news_archive` 混回一个面
- 把 collector / object storage / app-api / ingestion / retrieval 拆成多条并发 workstream

## Lifecycle Contract

- 文档 lifecycle 保持 `deferred`
- repo 级 registry state 当前对应 backlog；是否恢复执行只看 `.planning/WORKSTREAMS.md`
- 本文只保留固定顺序、surface posture 与 reopen 约束

## Current Baseline

当前 merged truth 已固定的前提：

- `stable_reference` 继续是默认 institutional reference surface
- `fresh_news` 与 `news_archive` 继续不是默认 query-enabled surface
- `apps/app-api` 继续是 official-web control-plane owner
- 新闻 opening 仍依赖同一套 source-truth、runtime profile、routing 与 acceptance contract

## Execution Contract

这条线始终按一条 workstream 推进：

1. source-channel / control-plane truth refresh
2. `stable_reference` maintenance / evidence continuity
3. `fresh_news` opening
4. `news_archive` opening
5. acceptance evidence and planning closeout

固定原因：

- source-truth contract、control-plane owner 与 downstream opening gate 共享同一条 truth
- 必须先稳住 `stable_reference`，才能讨论新闻面的 reopen

## Fixed Rules

- `stable_reference` 持续是默认 institutional reference surface
- `fresh_news` 只服务 freshness-sensitive、intent-scoped query
- `news_archive` 只服务显式历史查询、operator、评测或分析
- 重开前不得把 seed baseline、本地 import/release 或单轮 closeout evidence 写成 already-open truth

## Forward Phases

### Phase A: Source Channel / Control-Plane Follow-Up

目标：

- 收口 source-truth、crawl-run ledger、artifact refs 与 operator query 的 residual gap

### Phase B: `stable_reference` Maintenance

目标：

- 保持默认 reference surface 的质量与证据连续性

### Phase C: `fresh_news` Opening

目标：

- 完成 `fresh_news` 的 source refresh、import/release、quality gate 与 runtime opening acceptance

### Phase D: `news_archive` Opening

目标：

- 完成 `news_archive` 的历史面开放与 acceptance

### Phase E: Acceptance Evidence And Planning Closeout

目标：

- 把 opened/default-off/operator-only posture 写回 planning

## Exclusions

固定不包含：

- collector foundation 重写
- panel ownership 改写
- 默认 institutional surface 的语义重定义

## Handoff Rule

后续接手时：

1. 先看 `.planning/WORKSTREAMS.md`
2. 再看 `official_web` architecture / reference / checklist
3. 最后回到本文确认固定顺序与 surface posture
