---
doc_type: plan
status: active
created: 2026-04-06
updated: 2026-04-10
---

# Post-Closeout Follow-Up Execution Plan

**Goal:** 在不改动当前 accepted architecture、institution-scoped 产品边界和已关闭 deterministic gates 的前提下，把 repo 从“主链路 closeout 已完成”推进到“staging 可验证、补充质量收口、下一条产品 slice 可启动”的执行状态。

**Architecture:** 当前 merged truth 继续以 `docs/architecture/current-architecture.md`、`docs/decisions/adr-0028-campus-navigation-basemap-and-provider-strategy.md`、`docs/decisions/adr-0030-institution-scoped-product-path-and-explicit-open-domain-admission.md` 为准；本文只负责当前 worktree 的后续执行顺序、依赖和交付边界。

**Current Scope:** `official-web` / Phase 10 由其他 worktree 处理，不进入本计划。

---

## Summary

当前后续工作不再以“再补一轮 phase 1-11 主链路缺口”为目标，而按真实阻塞强度排序推进：

1. curriculum supplemental soft-warn diagnosis
2. authenticated-notice post-closeout consumption
3. place-finding foundation

排序理由：

- planning truth refresh 与当前 worktree hygiene 已在 Wave A 完成，当前只需持续消费既有 truth。
- staging 已在 2026-04-09 完成 full-lane closure，当前只需要保留并消费既有 smoke / observability evidence，不再作为 active implementation blocker。
- `public-chat-web` 的 strict donor parity 已在 2026-04-09 通过 Wave 6 closeout 关闭，当前不再占用 active workstream。
- curriculum deterministic gate 已关闭，剩下的是 soft-warn 诊断，不应伪装成 release blocker。
- authenticated-notice 的历史 closeout 已真实完成；后续重心从“收口脏工作区”切到“消费已完成 closeout、推进 chunk-prep admission、offline release 与下游质量验证”。
- place-finding 是下一条前向产品 slice，但不阻塞前面几条收口。

## Current Repo Position

当前 repo 已知事实：

- `student_handbook` 当前 pass artifact 为 `20260404T072912Z`
- `curriculum_plan` 当前 latest completed live artifact 为 `.tmp/evals/curriculum-plan-live-gate-accept-20260404T200443Z`
- curriculum live accept 已达到 deterministic `19/19` pass，当前剩余问题只在 supplemental soft-warn
- 三个 Worker app 的 staging posture 已收口到项目隔离一级子域：`campus-api-staging.ayafeed.com`、`campus-chat-staging.ayafeed.com`、`campus-panel-staging.ayafeed.com`
- `workers_dev = false` 与 `preview_urls = false` 已进入 repo 配置
- `place_lookup` / `place_finding` 已冻结为导航相关首个前向 slice，`route_planning` 明确后置
- campus path 继续保持 institution-scoped，不接受隐式 open-domain fallback

当前仍未关闭的事实：

- authenticated-notice historical closeout 已通过真实 run `authenticated-notice-replay-20260406-024405` 收口，verification / promotion 均完成；但 2026-04-10 fresh current-scope validator 仍显示陈旧 promoted truth 未过质量门，因此下一条可执行动作先是 `campus_notices/internal_notice` 的 full current-scope `source_truth_replay` refresh，再进入 chunk preparation / guarded registry release
- live portal scheduling 与 authenticated control plane 仍是后续 deferred work

## Current Execution Status

- Wave A 已于 2026-04-06 收口完成：repo-level follow-up order 已落盘，`.planning/PROJECT.md` / `.planning/STATE.md` 已切到 acceptance-closeout / launch-hardening 叙述；authenticated-notice 历史 closeout 的最终 evidence 现已固定到 `docs/reference/authenticated-notice-historical-closeout-evidence.md`
- Wave A 针对性验证当前通过：`tests.ingestion.test_authenticated_notice_import`、`tests.ingestion.test_import_authenticated_notice_export_worker`、`tests.ingestion.test_authenticated_notice_closeout_async`、`tests.ingestion.test_rebuild_authenticated_notice_source_truth_inventory_worker` 合计 `29/29` 通过
- Wave B1 已完成当前 worktree 的 Wave 1 最小实现：`retrieval-core` 已对已解析到唯一 `target_document_ids` 的 handbook / curriculum 请求启用 targeted overfetch，并通过 `tests/ingestion/test_corpus_runtime_profile.py` 与 `tests/retrieval/test_backend_qdrant.py`
- Wave B2 已完成当前 worktree 的结构性收口：新增仅供内部检索使用的 `curriculum/program_semester_facts` projection surface，把“已解析到唯一培养方案 + 唯一学期 + course_list intent”的课表问句从 raw `curriculum_plan` table chunk 热路径迁到 answer-shaped semester facts，并通过投影 / specialist / rebuild 定向验证
- Wave B 已于 2026-04-09 完成真实 staging closeout；同日 Workstream 2A 也已完成 `public-chat-web` Wave 6 strict parity closeout，Wave D 已从“closeout 本身”前进到“closeout 之后的 current-scope refresh / offline release / retrieval-prep consumption”
- 2026-04-10 Wave D 已完成离线 ingestion management/direct posture 的 repo-level 修复：full refresh / validation / preparation / release 相关 builder 现已切到 `prefer_management=True`，并新增 `CAMPUS_SHARED_POSTGRES_MANAGEMENT_URL` + fast-fail guardrail，不再接受把 session pooler 冒充成 management DSN
- 同日再次执行 full current-scope refresh 时，repo 已越过原先的 `psycopg_pool.PoolTimeout` 代码路径；新的 active blocker 已收敛为 operator env truth：当前本地 `APP_API_MANAGEMENT_DATABASE_URL` 仍指向 `*.pooler.supabase.com`，被 direct connect 以 `MaxClientsInSessionMode` 明确拒绝，因此 current-scope refresh 仍待真实 direct management DSN 到位

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

## Workstream 2: Wave B - Staging Deployment Closure（Completed）

目标：

- 把 `app-api`、`public-chat-web`、`protected-panel-web` 的 staging 从“配置准备完成”推进到“真实闭环 smoke 已完成”

执行边界：

- 优先级顺序固定为：`app-api-staging auth/DB runtime` -> `chat-staging` -> `panel-staging Access` -> full live smoke
- 继续使用一级子域 custom domains，不回退到 `*.rag.ayafeed.com`
- panel staging 必须接入真实 Cloudflare Access，不接受 worker-only admission 伪完成
- 优先使用 Cloudflare 原生 OTLP 到 Sentry / Axiom；没有账户能力前，不额外发明 Tail Worker 作为默认路径
- runtime DB 继续保持 Hyperdrive / management URL 分工，并显式校验 pooler / SSL / fresh lane 姿态

当前结果：

- `.tmp/staging-smoke/20260406T032941-wave-b-closure/`
- `.tmp/staging-smoke/20260406T115658-panel-requests-fix/SUMMARY.md`
- `.tmp/observability-smoke/20260406T032941-staging-wave-b/`
- `.tmp/observability-smoke/20260409T204915-staging-wave-b-sentry-closure/`

## Workstream 2A: `public-chat-web` Strict Donor Parity Wave 6 Closeout（Completed）

目标：

- 把 `apps/public-chat-web` 从“Wave 1-5 code-closeout 已完成”推进到“strict donor parity release gate 与 smoke evidence 全部关闭”

执行边界：

- 不改动 `public-chat-web -> app-api -> supervisor-api` accepted topology
- `/login` 继续 repo-owned，不进入 donor parity 本身
- 当前 cutover、same-site `/api/*`、staging hostname 与 preview seam removal 证据继续保留，但不得再被解释成 strict parity 已关闭
- Wave 1-5 的 code-level correction 已完成，不再把 route status card、patched composer navigation、repo-local message/tool fallback、artifact/document runtime patch 留在工作树里
- 当前剩余工作只允许是 donor diff whitelist、desktop/mobile browser parity smoke、staging parity evidence 与 checklist closeout

交付物：

- 更新后的 donor parity checklist / donor baseline / gap inventory / README
- Wave 1-5 code-closeout 的 repo verification evidence
- Wave 6 donor diff whitelist、desktop/mobile browser smoke、staging parity evidence，以及 `.planning/phases/999.1-smoke-evidence-deferred-backlog/README.md` 的 closeout

当前结果：

- `docs/reference/public-chat-web-donor-diff-whitelist.md`
- `.tmp/staging-smoke/20260409T232000+0800-public-chat-wave6-closeout-2/`
- `share / visibility on launch path` blocker 已关闭并进入 regression gate
- `GET /api/models` 已在 staging 返回 `200`，`/api/history` 在真实登录会话下返回 `200`
- `pnpm --dir apps/public-chat-web test:worker`、`typecheck`、`build` 已 fresh 通过

### Wave B1 - Supervisor Retrieval Tail-Latency Remediation

目标：

- 收口 staging 上 `Supervisor execution exceeded 15000ms timeout.` 的已定位 retrieval tail latency
- 仅修正在线 retrieval 形状，不回退当前 accepted app topology

执行边界：

- 根因已经定位为 `retrieval-core` 热路径，而不是 `public-chat-web` 或 `app-api` transport seam
- Wave 1 只改 `packages/retrieval-core`、collection runtime profile 与对应测试；不改 `public-chat-web -> app-api -> supervisor-api` 拓扑
- 对已经解析到唯一 `target_document_ids` 的 handbook / curriculum 问句，在线 path 改为首轮单次 targeted overfetch，并跳过 follow-up support query
- curriculum 的 same-document `scroll` 不再作为这类已解析问句的在线补证手段
- 不把单纯增大 `SUPERVISOR_API_TIMEOUT_MS` 当作主修复；timeout 调整只允许作为 staging 临时缓冲，而不是根因修复

交付物：

- 一份 repo-tracked latency diagnosis / Wave 1 remediation 文档
- retrieval-core 行为修复与 targeted tests
- 针对 representative handbook / curriculum prompt 的 fresh verification evidence

### Wave B2 - Curriculum Program-Semester Internal Surface

目标：

- 收口 curriculum semester course-list 问句在 staging 上残留的 raw table retrieval 热路径
- 不新增公开 serving surface，只在 ingestion / specialist 内部新增 answer-shaped facts projection

执行边界：

- 新 surface 固定为 `curriculum/program_semester_facts`
- 仅在以下条件同时满足时切换路由：
  - `curriculum_plan` 已解析到唯一培养方案文档
  - query intent 为 `course_list`
  - 只命中一个规范化学期标签
- 它是 internal retrieval surface，不改变用户可见的 scope contract，也不把 `curriculum_plan` query-serving 默认面替换成新 collection
- rebuild / raw ingestion / eval expectation / confidence seam 必须一起对齐，避免 internal collection 漂成 undocumented side path

交付物：

- `program_semester_facts` projection 与 runtime profile
- specialist 路由与定向 `target_document_ids` 解析
- 覆盖投影、runtime profile、rebuild alias reset、specialist follow-up/deictic 路由的 targeted tests

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

当前结果（2026-04-09）：

- Wave C 的 repo-head truth / answer-shape remediation 已落地：
  - `course_facts` 相关 release/regression case 的 `reference_context_ids` 已从旧 raw doc truth 改成 internal fact doc ids
  - `rag-specialist` 现在对 `course_facts` 走 exact `target_document_ids`，并把课程 answer 收口为 direct fact wording
  - raw `curriculum_plan` 的 `学制` / `总学分` 短事实问句不再默认走通用 lead + 低相关同文档拼接
- fresh verification 已通过：
  - `tests.evals.test_golden_cases`
  - `tests.evals.test_context_diagnostics`
  - `tests.specialist.test_rag_specialist`
  - `tests.evals.test_curriculum_live_benchmark`
  - `tests.evals.test_ragas_runtime`
- 2026-04-10 已执行一轮 fresh curriculum live rerun/accept，目标是替换历史 `20260404T200443Z` warn artifact：
  - rerun artifact：`.tmp/evals/curriculum-plan-live-gate-accept-20260410-wave-c/`
  - 当前 run 未进入 benchmark case 执行，直接在 `run/supplemental-preflight.json` fast-fail
  - `failure_disposition = non_retryable_request`
  - `failure_reasons = [preflight_failed, provider_contract_violation]`
  - 根因已定位为 supplemental LLM provider `https://www.su8.codes/codex/v1` 的 Responses contract regression：text / json-schema probe 都返回 `status='completed'` 但 `output=[]`
  - repo 已把这类返回升级为 `provider_contract_violation` / `non_retryable_request` fast-fail，而不是继续把它伪装成“soft-warn 仍待解释”
- 因此当前 Wave C 的 remaining step 已变化：
  - curriculum repo-head truth / answer-shape remediation：已完成
  - historical warn artifact replacement：等待 supplemental provider 恢复符合 contract 的 `/responses` 输出，或切换到明确满足该 contract 的 eval provider runtime
  - 在 provider 未恢复前，下一条前向 workstream 直接转入 Wave D

## Workstream 4: Wave D - Authenticated-Notice Post-Closeout Consumption

目标：

- 在历史 closeout 已完成的基础上，先刷新 `internal_notice` current scope 的 source-truth / staged truth，再推进 chunk-prep admission、offline release、release evidence 与后续 retrieval-prep consumption

执行边界：

- closeout 当前 truth 以 real run `authenticated-notice-replay-20260406-024405` 为准，不再把 `6694` historical closeout 记为待执行项
- 2026-04-10 fresh current-scope validator 仍返回 `passed=false`：`chunk_failures=1`、`notice_body_fragmentation_count=5`、`markup_leak_chunk_count=724`、`header_dominant_ocr_chunk_count=130`、`noisy_ocr_chunk_count=31`
- 同日 repo-head 已修两项真实缺口：`source_truth_replay` parent projection 缺失 `ocr_provider_response_cache` 的 worker crash，以及 `notice_body` token-guardrail short-tail fragmentation；bounded probe `internal-notice-wave-d-241275-20260410-03` 已验证 `241275` 的 `notice_body_fragmentation_count=0`
- 因此第一条 canonical 动作不再是直接 `prepare_registry_scope_chunks`，而是新的 full async `source_truth_replay` 来刷新 current scope truth
- 当前这条 refresh 又额外受 shared Postgres session-pooler connectivity 阻塞；在 worker runtime 能重新完成实际 Postgres connect 之前，不能宣称 Wave D 已进入 replay / prepare / release
- 只有 refresh 后的 verified replay 当前 scope 重新通过 quality validator，才允许执行 `prepare_registry_scope_chunks --corpus campus_notices --collection internal_notice --preparation-run-id <prep_id>`
- 只有 verified chunk preparation 成功后，才允许执行 `release_registry_scope --corpus campus_notices --collection internal_notice --preparation-run-id <prep_id> --no-publish-alias`
- release 成功后记录 preparation manifest、release manifest、validation summary、physical collection 与未发布 alias 的事实
- live portal scheduling 与 authenticated control plane 仍后置
- 不能把 `offline_preparation` collection 的离线 release 写成 query-serving 开放

交付物：

- full current-scope source-truth refresh 执行结果
- chunk preparation 与 offline release 执行结果
- 对应 docs/runbook/reference/verification
- post-closeout consumption 的新 execution order

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

- Wave C truth / context / evaluator 诊断
- Wave D 的 offline release 与 post-closeout consumption
- Wave E 的 contract / source-truth / seed 设计

外部阻塞：

- Wave D 的 full current-scope refresh 当前受 operator env truth 阻塞：在可用的 `CAMPUS_SHARED_POSTGRES_MANAGEMENT_URL`（真实 direct DSN，而不是 session pooler）到位前，不能继续 replay / prepare / release
- Wave D 的 live portal scheduling 与 authenticated control plane 依赖后续执行窗口与外部数据面配合

## External Posture

执行时继续采用以下 posture：

- Cloudflare Worker staging 以 custom domains 为正式入口，并关闭 `workers_dev` / preview URL
- protected surface 使用真实 Cloudflare Access，而不是 header 模拟
- observability 优先走原生 OTLP 出口到 Sentry / Axiom
- Supabase / Postgres 连接姿态按 runtime lane 区分 cached / fresh / management，不把 auth read-after-write 问题掩盖成前端故障
- campus path 不引入隐式 open-domain fallback
