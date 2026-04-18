---
doc_type: plan
status: deferred
created: 2026-04-18
updated: 2026-04-18
---

# Official Web Source Channel And News Opening

## 文档边界

本文固定 `official-web source channel / news opening` 这条单一 workstream 的前向范围：

- `official_web` source-channel / control-plane follow-up
- `official_web/stable_reference` 的持续维护、证据连续性与 mixed bridge residue 收口
- `official_web/fresh_news` opening execution / acceptance
- `official_web/news_archive` opening execution / acceptance

本文不负责：

- 在当前分支直接把 `fresh_news` 或 `news_archive` 重开成 active runtime
- 把 `stable_reference`、`fresh_news`、`news_archive` 重新混回一个默认 surface
- 把 collector 重写成新的长期架构线
- 把 `official_web` 拆成 collector / object-storage / app-api / ingestion / retrieval 多条并发 workstream

## 当前生命周期状态

- 当前状态是 `deferred`
- planning 状态对应 `.planning/WORKSTREAMS.md` 中的 backlog 条目；当前不预建 native workstream 目录
- 这条线当前只是明确入口，不表示已经恢复执行优先级
- 恢复后仍保持单一 workstream；并行只允许发生在与它无共享写集的其他 workstreams 之间

## 直接结论

`official_web` 的后续工作不应拆成多条并发 workstream。

它必须作为一条 `official-web source channel / news opening` workstream 推进，固定顺序如下：

1. source-channel / control-plane truth refresh
2. `stable_reference` maintenance / evidence continuity
3. `fresh_news` opening execution
4. `news_archive` opening execution
5. acceptance evidence and planning closeout

原因固定为：

- `official_web` 的 source-truth contract、control-plane owner 与 downstream opening gate 属于同一条 source-channel truth
- `stable_reference` 是默认 institutional reference surface；先稳住它，才能讨论新闻面 reopening
- `fresh_news` 与 `news_archive` 的 opening 依赖同一套 source-truth、runtime-profile、routing 与 acceptance contract；拆 lane 会诱导提前开面或混淆默认面
- panel operator surface、collector admission、artifact refs 与 ingestion handoff 继续共享 `apps/app-api` 这一 control-plane owner

## 前置真相

接手这条线之前，先以以下文档为准：

- `docs/architecture/official-web-architecture.md`
- `docs/architecture/official-web-serving-and-news-retrieval-strategy.md`
- `docs/architecture/official-web-freshness-and-incremental-crawling.md`
- `docs/architecture/official-web-source-truth-contract.md`
- `docs/domains/official-web.md`
- `docs/reference/official-web-news-surface-opening-checklist.md`
- `.planning/legacy-flat/phases/1003-official-web-opening-policy-runtime-gate/1003-CONTEXT.md`
- `.planning/PROJECT.md`
- `.planning/WORKSTREAMS.md`

## 固定执行规则

- `official_web/stable_reference` 持续是默认 institutional reference surface
- `fresh_news` 只允许面向 intent-scoped、freshness-sensitive query；不回填默认稳定面
- `news_archive` 只允许服务显式历史查询、operator、评测或分析，不作为 `fresh_news` 默认回填面
- 当前 workstream 重开前，不把 seed baseline、本地 import/release 或独立 worktree evidence 冒充成当前分支已 open
- 如果问题根因落在 shared `apps/app-api` official-web control plane，修复必须回到该边界，不在 panel、collector shim 或 retrieval side 叠 patch
- collector / object storage / app-api / ingestion / retrieval 的接口修订都视为这条单一 workstream 的顺序子层，不再平行拆 lane

## Phase A: Source Channel / Control-Plane Follow-Up

目标：

- 确认 `official_web` source-channel、collector admission、crawl-run ledger、artifact refs、operator query 与 ingestion handoff 没有留下新的 ownership 漂移
- 在 reopening 新闻面之前，先把 control-plane 与 source-truth 的 follow-up 欠账收口

退出条件：

- `apps/app-api` 继续是唯一 official-web control-plane owner
- source-truth contract、policy 文档与 operator surface 没有新的冲突
- reopening 不再依赖未落盘的 control-plane 假设

## Phase B: `stable_reference` Maintenance / Evidence Continuity

目标：

- 保持 `official_web/stable_reference` 作为默认 institutional reference surface 的质量与证据连续性
- 收口 mixed bridge residue、split manifest 漂移、qrels / live-gate / release evidence 老化等后续问题

退出条件：

- `stable_reference` 的默认面语义、release evidence 与 retrieval baseline 继续可追溯
- mixed bridge 不再被误写成默认 query-facing surface
- `fresh_news` / `news_archive` opening 不需要再反向修改 `stable_reference` 的默认 contract

## Phase C: `fresh_news` Opening Execution

目标：

- 在产品优先级重新开启后，完成 `official_web/fresh_news` 的 source refresh、import/release、quality gate 与 runtime opening acceptance

退出条件：

- freshness-sensitive routing、metadata、retrieval baseline 与 acceptance checklist 全部成立
- `fresh_news` 仍保持 intent-scoped surface，而不是默认 institutional surface
- opening evidence 可以独立说明为什么允许打开 `fresh_news`

## Phase D: `news_archive` Opening Execution

目标：

- 在 `fresh_news` opening 完成后，再处理 `official_web/news_archive` 的历史面开放与 acceptance

退出条件：

- `news_archive` 只服务显式历史查询、operator、评测或分析
- 它不回填 `fresh_news` 默认查询，也不混入 `stable_reference`
- opening evidence 可以独立说明 archive 面的用途与限制

## Phase E: Acceptance Evidence And Planning Closeout

目标：

- 把 source-channel、`stable_reference`、`fresh_news`、`news_archive` 的最终状态写回 planning truth，并关闭这条 workstream 的 reopen 语义漂移

退出条件：

- `.planning/PROJECT.md`、`.planning/WORKSTREAMS.md` 与相关 reference 文档已更新
- 已明确记录哪些面已经 opened、哪些仍 default-off、哪些仍仅供 operator/eval 使用
- 不把一次局部 import/release 成功误写成整个 workstream 已完成

## 接手标准

其他会话接手这条线时，默认按以下顺序开始：

1. 先检查 `.planning/WORKSTREAMS.md`，确认这条线是否仍处于 backlog，还是已经被显式恢复
2. 如果只是恢复执行，不要直接跳到 `fresh_news` opening；先从 `source-channel / control-plane` 与 `stable_reference` 当前真相开始核对
3. 完成后再更新 `.planning/PROJECT.md`、`.planning/WORKSTREAMS.md` 与相关 evidence 文档
