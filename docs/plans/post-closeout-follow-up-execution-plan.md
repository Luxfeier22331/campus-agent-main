---
doc_type: plan
status: active
created: 2026-04-06
updated: 2026-04-06
---

# Post-Closeout Follow-Up Execution Plan

**Goal:** 在不改动当前 accepted architecture、institution-scoped 产品边界和已关闭 deterministic gates 的前提下，把 repo 从“主链路 closeout 已完成”推进到“staging 可验证、补充质量收口、下一条产品 slice 可启动”的执行状态。

**Architecture:** 当前 merged truth 继续以 `docs/architecture/current-architecture.md`、`docs/decisions/adr-0028-campus-navigation-basemap-and-provider-strategy.md`、`docs/decisions/adr-0030-institution-scoped-product-path-and-explicit-open-domain-admission.md` 为准；本文只负责当前 worktree 的后续执行顺序、依赖和交付边界。

**Current Scope:** `official-web` / Phase 10 由其他 worktree 处理，不进入本计划。

---

## Summary

当前后续工作不再以“再补一轮 phase 1-11 主链路缺口”为目标，而按真实阻塞强度排序推进：

1. planning truth refresh 与 worktree hygiene
2. staging deployment closure
3. curriculum supplemental soft-warn diagnosis
4. authenticated-notice deferred follow-up
5. place-finding foundation

排序理由：

- 先把 planning truth 和当前 worktree 脏状态对齐，后续执行才不会继续漂移。
- staging 仍是上线前的真实阻塞项，优先级高于继续追加 retrieval 微调。
- curriculum deterministic gate 已关闭，剩下的是 soft-warn 诊断，不应伪装成 release blocker。
- authenticated-notice 当前还有一组 inventory / bulk-stage follow-up 停留在 dirty worktree，必须先收口或显式 park。
- place-finding 是下一条前向产品 slice，但不阻塞前面几条收口。

## Current Repo Position

当前 repo 已知事实：

- `student_handbook` 当前 pass artifact 为 `20260404T072912Z`
- `curriculum_plan` 当前 latest completed live artifact 为 `.tmp/evals/curriculum-plan-live-gate-accept-20260404T200443Z`
- curriculum live accept 已达到 deterministic `19/19` pass，当前剩余问题只在 supplemental soft-warn
- 三个 Worker app 的 staging posture 已收口到一级子域：`api-staging.ayafeed.com`、`chat-staging.ayafeed.com`、`panel-staging.ayafeed.com`
- `workers_dev = false` 与 `preview_urls = false` 已进入 repo 配置
- `place_lookup` / `place_finding` 已冻结为导航相关首个前向 slice，`route_planning` 明确后置
- campus path 继续保持 institution-scoped，不接受隐式 open-domain fallback

当前仍未关闭的事实：

- staging 还没有完成真实闭环 live smoke
- Cloudflare custom domain / Access / secret / observability 证据仍依赖外部 provision
- authenticated-notice 大 `6694` backfill、live portal scheduling、authenticated control plane 仍是 deferred
- 当前 worktree 里仍存在一组未提交的 authenticated-notice inventory / bulk-stage follow-up 变更，需要收口

## Current Execution Status

- Wave A 已于 2026-04-06 收口完成：repo-level follow-up order 已落盘，`.planning/PROJECT.md` / `.planning/STATE.md` 已切到 post-closeout follow-up 叙述，authenticated-notice inventory / weighted planning / bulk-stage / frozen-inventory verifier / worker rebuild follow-up 已被登记为 near-term active work
- Wave A 针对性验证当前通过：`tests.ingestion.test_authenticated_notice_import`、`tests.ingestion.test_import_authenticated_notice_export_worker`、`tests.ingestion.test_authenticated_notice_closeout_async`、`tests.ingestion.test_rebuild_authenticated_notice_source_truth_inventory_worker` 合计 `29/29` 通过
- 下一条 active workstream 是 Wave B staging deployment closure；authenticated-notice 当前 dirty diff 则作为 Wave D 的近端前置项继续推进

## Workstreams

## Workstream 1: Wave A - Truth Refresh And Worktree Hygiene

目标：

- 把 repo-level planning truth 与最新 closeout 状态对齐
- 明确当前 dirty worktree 中 authenticated-notice follow-up 的归属与处理顺序

执行边界：

- `.planning/PROJECT.md`、`.planning/STATE.md`、`docs/README.md` 必须同步最新后续优先级
- 当前 worktree 的 authenticated-notice 变更要么进入 active todo 并验证，要么显式 park；不能继续无状态漂浮
- 不在这一波里虚构已完成的 staging 或 place-finding 进度

交付物：

- 一份 repo-tracked follow-up plan
- 更新后的 `.planning/PROJECT.md` / `.planning/STATE.md`
- 一条明确的 authenticated-notice pending todo
- 针对当前 authenticated-notice dirty diff 的验证结果

## Workstream 2: Wave B - Staging Deployment Closure

目标：

- 把 `app-api`、`public-chat-web`、`protected-panel-web` 的 staging 从“配置准备完成”推进到“真实闭环 smoke 已完成”

执行边界：

- 优先级顺序固定为：`app-api-staging auth/DB runtime` -> `chat-staging` -> `panel-staging Access` -> full live smoke
- 继续使用一级子域 custom domains，不回退到 `*.rag.ayafeed.com`
- panel staging 必须接入真实 Cloudflare Access，不接受 worker-only admission 伪完成
- 优先使用 Cloudflare 原生 OTLP 到 Sentry / Axiom；没有账户能力前，不额外发明 Tail Worker 作为默认路径
- runtime DB 继续保持 Hyperdrive / management URL 分工，并显式校验 pooler / SSL / fresh lane 姿态

交付物：

- 新的 `.tmp/staging-smoke/<timestamp>/SUMMARY.md`
- runbook / todo 状态更新
- 真实浏览器 smoke 与 observability evidence

## Workstream 3: Wave C - Curriculum Supplemental Warn Diagnosis

目标：

- 解释并收口 current curriculum live artifact 中剩余的 soft-warn

执行边界：

- deterministic gate 不重新打开
- 先查 case truth、`reference_context_ids`、applicability 和 ranking，再看 evaluator 漂移
- 不把“放宽阈值”作为第一动作

交付物：

- per-case 诊断记录
- 必要的 truth / fixture / docs 修订
- 更新后的 `docs/reference/curriculum-plan-eval-metrics.md`

## Workstream 4: Wave D - Authenticated-Notice Follow-On

目标：

- 在历史 closeout 已完成的基础上，推进后续 replay / promotion 效率与 deferred 大任务

执行边界：

- 先处理当前 worktree 中的 inventory-backed planning、weighted shards / batches、bulk stage writers、frozen inventory verification 变更
- 之后才进入大 `6694` backfill、live portal scheduling、authenticated control plane
- 不能把当前 worktree 进度写成 merged truth

交付物：

- inventory-backed replay planning 收口结果
- 对应 docs/runbook/verification
- deferred follow-up 的新 execution order

## Workstream 5: Wave E - Place-Finding Foundation

目标：

- 启动 `place_lookup` / `place_finding` 第一条前向产品 slice

执行边界：

- 只做 repo-owned `place_catalog`、institution-scoped alias resolution、place result contract、location card
- 不把 route planning、全量地图平台、provider truth 一起拉进第一期
- provider 只作为 adapter/runtime concern，不升级为 canonical spatial truth

交付物：

- `place_catalog` seed 和 source-truth protocol
- navigation-specialist 首发 contract
- chat answer + location card 最小闭环

## Blocked Vs Ready

现在就可以做：

- Wave A 全部
- Wave C truth / context / evaluator 诊断
- Wave D 当前 dirty authenticated-notice follow-up 的收口判断
- Wave E 的 contract / source-truth / seed 设计

外部阻塞：

- Wave B 依赖真实 Cloudflare custom domains、Access、secret injection、release、Sentry/Axiom 访问权限
- Wave D 的大 backfill / live portal scheduling 依赖后续执行窗口与外部数据面配合

## External Posture

执行时继续采用以下 posture：

- Cloudflare Worker staging 以 custom domains 为正式入口，并关闭 `workers_dev` / preview URL
- protected surface 使用真实 Cloudflare Access，而不是 header 模拟
- observability 优先走原生 OTLP 出口到 Sentry / Axiom
- Supabase / Postgres 连接姿态按 runtime lane 区分 cached / fresh / management，不把 auth read-after-write 问题掩盖成前端故障
- campus path 不引入隐式 open-domain fallback
