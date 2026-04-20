---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: in_progress
stopped_at: 2026-04-14 已按产品决策暂停导航产品路径：校内导航暂不支持，`place_card` / map consumption 延后到地图上线后再恢复
last_updated: "2026-04-19T00:22:44+08:00"
progress:
  total_phases: 32
  completed_phases: 29
  total_plans: 80
  completed_plans: 79
---

# Project State

## State File Contract

- `PROJECT.md`
  - 项目级真相：范围、关键决策、validated/active/out-of-scope 与当前 truth
- `STATE.md`
  - 当前 worktree 的 active / paused / backlog workstreams、per-workstream current slice、共享 blockers、recent verification 与 continuity；不再假定 repo 只有一条全局 active lane
- `ROADMAP.md`
  - phase 顺序、插入记录与执行历史

## Project Reference

See: `.planning/PROJECT.md` (updated 2026-04-19)

**Core value:** 以已冻结的 supervisor-led multi-agent 架构和已落盘 serving/eval truth 为基础，完成验收收口、上线前硬化与真实产品面一致性，而不是继续把仓库当作地基期实验场
**Now:**
- repo 当前按 workstream 组织多线开发：不同会话可并行接手不同模块，但同一 workstream 内仍严格按既定顺序和边界推进
- Phase 1000 `Curriculum 结构化证据契约与 Semester Facts 修复` 已在当前 worktree 完成：`1000-01` 到 `1000-04` 全部关闭，fresh accept artifact 位于 `.tmp/evals/curriculum-plan-live-gate-accept-phase1000/`
- `retrieved_sources` 与 `supporting_sources` 现已在 supervisor / eval / app-api / operator trace 上稳定拆分；`课程地图` unsupported 分支继续 fail-close，不再伪造 retrieval trace
- `program_semester_facts` 已按定向 rematerialization 修复稀疏表格丢行问题，并已发布 fresh release `r20260413_042533`
- Phase 1001 的 foundation 部分已完成到 `1001-02`：`place_catalog` authoritative source / nullable geometry / first-batch seed truth 继续保留为 repo-owned foundation
- 校内导航当前已按产品决策改为暂不支持：supervisor 产品路径现对 `place_lookup` fail-close，不再委派 `navigation-specialist`
- `place_card` / map consumption 已转入 backlog `999.2`，等待校园地图实际上线后再恢复
- Phase 16 `OCR 资产分类与双渠道择优路由` 继续保持 completed 状态；其 canonical scope 结论不因 Phase 1000 closeout 漂移
- Phase 15 `幻觉治理与 Grounded Generation 二次硬化` 已完成 repo-local closeout；当前不再有该 phase 的 active code lane
- Phase 14 `Prompt Stack / System Prompt Runtime` closeout 已在当前 worktree 完成；staging closeout、`public-chat-web` strict donor parity 与导航 foundation 都已退出当前主动实现主线
- Phase 1002 `Worker 部署与发布硬化收口` 已在当前 worktree 落地：三端 staging release identity 已统一为 deploy-time 注入，canonical per-app `deploy:preflight:staging` 与 release-scoped observability artifact contract 已写回 repo-owned scripts / tests / runbooks
- Phase 1003 `Official Web 新闻面 opening policy 与 runtime gate 收口` 已在当前 worktree 落地：`fresh_news` / `news_archive` 的 repo-level opening policy、runtime-profile contract、default-off query boundary 与独立 worktree opening checklist 已写回 docs / configs / tests；后续 opening execution / acceptance 已下调到 backlog `999.4`
- authenticated-notice Wave D 已完成 local Postgres current-scope refresh、preparation、promote 与 unpublished release；当前剩余是 post-release downstream consumption 和后置的 live portal / authenticated control-plane；前者继续留在当前 active downstream / owner-recovery lanes，后者已登记为单独 deferred workstream，不再被写成 repo 唯一 active lane
- `internal_notice -> regulations/institutional_regulations` 的 regulation import 已完成当前一轮 formal local current-scope materialization：当前固定按 vetted notice-id 白名单执行，结果为 `promotion_candidate_count=11`、`promotion_manual_review_count=0`、`materialized_document_count=11`、`current_target_count=11`；`191177` 当前作为 duplicate hold 保留在 source scope，`355282` 已通过 attachment owner repair + targeted projection rebuild 正式进入 target
- `shared product surfaces acceptance / hardening` 当前也作为一条并行 product workstream 保持 active：本地 Phase A-C baseline 已 fresh 通过，后续仍按 `app-api -> public-chat-web -> protected-panel-web -> integrated acceptance -> staging closeout` 推进
**External blockers / adjacent lanes:**
- curriculum supplemental provider blocker 与旧 artifact pointer replacement 都已关闭；curriculum 线当前不再有 repo-level follow-up blocker
- `official_web/fresh_news` / `official_web/news_archive` 的真实 opening execution / acceptance 已下调为 backlog `999.4`，当前不再作为 adjacent lane

## Current Position

Roadmap phase: no single active roadmap phase；当前执行面采用 workstream-first 的多线开发
Execution rule: repo 可以同时存在多条 active workstream；每条 workstream 的串行约束只在该 workstream 内部生效。各会话默认只更新自己推进的 workstream 条目，以及共享 blocker / verification delta。

### Active Workstreams

| Workstream | Status | Entry | Current Slice |
|------------|--------|-------|---------------|
| `authenticated-notice -> regulation downstream consumption` | active | `docs/plans/internal-notice-policy-regulation-consumption-implementation.md` | 当前固定维持 `11` 条 admitted regulation target + `scoped_rules` holding collection 的 non-auth bounded lane；继续收口 target-side metadata/quality gate，不做 unfiltered source-wide materialization，不碰 embedding/Qdrant/release，也不再混入 auth-window `file_release` owner recovery |
| `authenticated-notice file_release owner recovery` | active | `docs/plans/authenticated-notice-file-release-owner-recovery.md` | 当前前向切片固定为 `351119` 的 targeted `file_release` capture -> bounded owner body recovery -> promotion/materialization re-entry；不扩成 full export、source-wide replay 或 collector foundation 重写 |
| `product-path safety / prompt / grounding governance` | active | `docs/plans/archive/completed/hallucination-governance-and-grounded-generation-execution-plan.md` | 当前前向切片是 live artifact rerun replacement 与持续 release-gate 治理；敏感问题拦截 / system prompt / grounding runtime / eval artifact refresh 继续只作为同一条线的顺序子层 |
| `shared product surfaces acceptance / hardening` | active | `docs/plans/archive/completed/shared-product-surfaces-acceptance-hardening.md` | 当前本地 Phase A-C baseline 已 fresh 通过：`app-api` type/test/worker/shared-db integration、`public-chat-web` type/test/build、`protected-panel-web` type/test/build；下一步是 browser smoke 和 Phase D integrated acceptance，固定顺序仍是 `app-api -> public-chat-web -> protected-panel-web -> integrated acceptance -> staging closeout` |

### Paused / Backlog Workstreams

| Workstream | Status | Reopen Rule |
|------------|--------|-------------|
| `authenticated-notice live portal / authenticated control-plane` | deferred | 只有在认证窗口恢复，或产品范围决定恢复 source-channel live portal scheduling / authenticated control-plane 时才恢复 |
| `operator observability / control-plane` | deferred | 只有在产品范围决定把 panel 从当前 operator shell 扩成完整 observability control-plane 时才恢复 |
| `restricted document rollout / verification` | deferred | 只有在产品范围决定打开 restricted surface 或推进 restricted collection rollout 时才恢复 |
| `official-web source channel / news opening` | backlog `999.4` | 只有在产品范围重新提升新闻面 opening 优先级后才恢复 |
| `campus navigation rollout / place_card / map consumption` | backlog `999.2` | 等待校园地图实际上线后再恢复 |

- `authenticated-notice live portal / authenticated control-plane` 的唯一入口是 `docs/plans/authenticated-notice-live-portal-control-plane.md`
- 这条 deferred lane 覆盖 repo-native authenticated collector、live `notice` / `file_release` capture、scheduler/incremental sync、run ledger、artifact refs 与 source-channel control-plane
- 它恢复后仍保持单一 workstream，内部固定顺序为 `collector runtime/repo migration truth refresh -> auth bootstrap/live capture policy/scheduling -> run ledger/artifact refs/auth readiness -> live-historical reconcile -> operator control-plane/bounded APIs -> planning closeout`
- `operator observability / control-plane` 的唯一入口是 `docs/plans/operator-observability-control-plane-foundation.md`
- 这条 deferred lane 覆盖 app-owned request observability fact、audit/quality/safety/cost read model、panel 新域与 sink participation
- 它恢复后仍保持单一 workstream，内部固定顺序为 `request-scoped observability foundation -> audit projection -> metric rollup/APIs -> panel domain expansion -> sink participation/grading backflow -> planning closeout`
- `restricted document rollout / verification` 的唯一入口是 `docs/plans/restricted-document-rollout-and-verification.md`
- 这条 deferred lane 覆盖 restricted collection / release posture、public/operator/service surface behavior、allow/deny matrix 与泄露防护验证
- 它恢复后仍保持单一 workstream，内部固定顺序为 `authorization/release posture -> restricted collection rollout -> surface behavior -> verification/leakage hardening -> planning closeout`
- `official-web source channel / news opening` 的唯一入口是 `docs/plans/official-web-source-channel-news-opening.md`
- 这条 backlog lane 覆盖 `official_web` source/control-plane follow-up、`stable_reference` maintenance，以及 `fresh_news` / `news_archive` opening execution / acceptance
- 它恢复后仍保持单一 workstream，内部固定顺序为 `source/control-plane -> stable_reference maintenance -> fresh_news opening -> news_archive opening -> acceptance closeout`
- `campus navigation rollout / place_card / map consumption` 的唯一入口是 `docs/plans/campus-navigation-rollout-map-consumption.md`
- 这条 backlog lane 覆盖地图上线后的 `place_lookup` 产品路径恢复、`place_card` / map consumption，以及 staging/manual acceptance
- 它恢复后仍保持单一 workstream，内部固定顺序为 `map-launch preconditions -> place_lookup runtime recovery -> place_card/map consumption -> staging/manual acceptance -> planning closeout`

## Performance Metrics

**Velocity:**

- Total plans completed: 77
- Average duration: mixed agent-run and inline execution; see per-plan summaries
- Total execution time: 0.2 hours + 2026-03-24 inline Phase 2/3 execution

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01 | 2 | 9 min | 4.5 min |
| 02 | 2 | inline session | n/a |
| 03 | 2 | inline session | n/a |
| 03.1 | 3 | 53 min | 17.7 min |
| 03.2 | 2 | 17 min + inline | mixed |
| 04 | 3 | inline session | n/a |
| 04.1 | 3 | inline session | n/a |
| 04.2 | 2 | inline session | n/a |
| 04.3 | 2 | inline session | n/a |
| 04.4 | 2 | inline session | n/a |
| 04.5 | 2 | inline session | n/a |
| 04.6 | 3 | inline session | n/a |
| 04.7 | 2 | inline session | n/a |
| 05 | 3 | inline session | n/a |
| 05.1 | 4 | inline session | n/a |
| 06 | 2 | inline session | n/a |
| 07 | 2 | inline session | n/a |
| 08 | 2 | inline session | n/a |
| 09 | 3 | inline session | n/a |
| 10 | 3 | inline session | n/a |
| 10.1 | 3 | inline session | n/a |
| 10.2 | 3 | inline session | n/a |
| 10.3 | 3 | inline session | n/a |
| 10.4 | 2 | inline session | n/a |
| 10.5 | 2 | inline session | n/a |

**Recent Trend:**

- Last completed plans: 1000-01, 1000-02, 1000-03, 1000-04, 1001-01, 1001-02
- Trend: curriculum 主线保持关闭；导航 foundation 已完成 source inventory freeze 与 first-batch seed expansion，但产品路径已主动 fail-close，后续只保留地图上线后的 backlog 恢复项。

| Plan | Duration | Tasks | Files |
|------|----------|-------|-------|
| Phase 01-contract-and-boundary-guardrails P01 | 4m | 2 tasks | 11 files |
| Phase 01 P02 | 5m | 2 tasks | 3 files |
| Phase 02 P01 | inline | 2 tasks | 7 files |
| Phase 02 P02 | inline | 2 tasks | 6 files |
| Phase 03 P01 | inline | 2 tasks | see summary |
| Phase 03 P02 | inline | 2 tasks | see summary |
| Phase 03.1 P01 | 22 min | 2 tasks | 18 files |
| Phase 03.1 P02 | 12 min | 2 tasks | 11 files |
| Phase 03.1 P03 | 19 min | 2 tasks | 8 files |
| Phase 03.2 P01 | 17 min | 2 tasks | 5 files |
| Phase 03.2 P02 | inline | 2 tasks | 9 files |
| Phase 04 P01 | inline | 1 task | 4 files |
| Phase 04 P02 | inline | 1 task | 4 files |
| Phase 04 P03 | inline | 1 task | 4 files |
| Phase 04.1 P01 | inline | 2 tasks | see summary |
| Phase 04.1 P02 | inline | 2 tasks | see summary |
| Phase 04.1 P03 | inline | 1 task | see summary |
| Phase 04.2 P01 | inline | 1 task | 2 files |
| Phase 04.2 P02 | inline | 1 task | 1 file |
| Phase 04.3 P01 | inline | 1 task | 2 files |
| Phase 04.3 P02 | inline | 1 task | 1 file |
| Phase 04.4 P01 | inline | 1 task | 2 files |
| Phase 04.4 P02 | inline | 1 task | 1 file |
| Phase 04.5 P01 | inline | 2 tasks | 3 files |
| Phase 04.5 P02 | inline | 1 task | 1 file |
| Phase 04.6 P01 | inline | 2 tasks | 10 files |
| Phase 04.6 P02 | inline | 1 task | 2 files |
| Phase 04.6 P03 | inline | 1 task | 4 files |
| Phase 04.7 P01 | inline | 1 task | see summary |
| Phase 04.7 P02 | inline | 1 task | see summary |
| Phase 05 P01 | inline | 1 task | 5 files |
| Phase 05 P02 | inline | 1 task | 2 files |
| Phase 05 P03 | inline | 1 task | 6 files |
| Phase 05.1 P01 | inline | 2 tasks | see summary |
| Phase 05.1 P02 | inline | 2 tasks | see summary |
| Phase 05.1 P03 | inline | 2 tasks | see summary |
| Phase 05.1 P04 | inline | 2 tasks | see summary |
| Phase 06 P01 | inline | 2 tasks | see summary |
| Phase 06 P02 | inline | 2 tasks | see summary |
| Phase 07 P01 | inline | 2 tasks | handbook automated verification + planning closeout |
| Phase 07 P02 | inline | 2 tasks | live qrels/workflow evidence + docs refresh |
| Phase 08 P01 | inline | 3 tasks | dense roster regression + live r5 audit refresh + docs closeout |
| Phase 08 P02 | inline | 2 tasks | repo workflow freeze for stable gate vs low-budget expansion batch |
| Phase 09 P01 | inline | 1 task | requirement-owning phase verification backfill |
| Phase 09 P02 | inline | 2 tasks | Phase 07 artifact reconstruction + audit narrowing |
| Phase 09 P03 | inline | 2 tasks | final audit refresh + planning handoff alignment |
| Phase 10 P01 | inline | 2 tasks | runtime-profile serving-surface freeze + collection README truth |
| Phase 10 P02 | inline | 2 tasks | canonical `publishedAt` extraction + projection metadata propagation |
| Phase 10 P03 | inline | 3 tasks | freshness-sensitive fail-close + official-web eval truth lock |
| Phase 10.1 P01 | inline | 2 tasks | planning truth and project-level official-web closeout wording |
| Phase 10.1 P02 | inline | 2 tasks | current-truth partition helper + official-web handoff regression tests |
| Phase 10.1 P03 | inline | 2 tasks | fresh-news handoff reference + architecture/runbook alignment |
| Phase 10.2 P01 | inline | 2 tasks | failing tests for release-gate projection over-aggregation + chunking-audit truth |
| Phase 10.2 P02 | inline | 2 tasks | article-detail unit batching repair + audit rule alignment |
| Phase 10.2 P03 | inline | 2 tasks | replay verification + QC refresh + planning closeout |
| Phase 10.3 P01 | inline | 2 tasks | support-only role / chunk suppression / header normalization regression truth |
| Phase 10.3 P02 | inline | 2 tasks | support-only unit handling + retrieval/answer demotion + audit alignment |
| Phase 10.3 P03 | inline | 2 tasks | replay v9 verification + QC/policy/planning closeout |

## Accumulated Context

### Roadmap Evolution

- Phase 03.1 inserted after Phase 3: Availability Specialist 最小闭环 (URGENT)
- Phase 03.2 inserted after Phase 3: Source Truth Fan-Out And Attachment Projection (URGENT)
- Phase 04.1 inserted after Phase 4: Cloudflare Entry And Protected Panel Design (URGENT)
- Phase 04.2 inserted after Phase 04.1: Cloudflare Runtime Topology And Delivery Shape (URGENT)
- Phase 04.3 inserted after Phase 04.2: Public Entry Edge Integration Contract (URGENT)
- Phase 04.4 inserted after Phase 04.3: Protected Panel Runtime Shell (URGENT)
- Phase 04.5 inserted after Phase 4: Cloudflare Worker Consumer Entry And Access Policy (URGENT)
- Phase 04.6 inserted after Phase 4: Cloudflare Worker Runtime Implementation (URGENT)
- Phase 04.7 inserted after Phase 4: Public Consumer Chat App Design (URGENT)
- Phase 05.1 inserted after Phase 5: 研究 curriculum 的 chunking 策略 (URGENT)
- Phase 08 added: Official Web Repo Hardening And Expansion
- Phase 09 added after Phase 8: Worktree Milestone Evidence Closure (audit-driven)
- Phase 10 added after Phase 9: Official Web Serving Surface Stratification And Fresh News Readiness
- Phase 15 added after Phase 14: 幻觉治理与 Grounded Generation 二次硬化
- Phase 16 added after Phase 15: OCR 资产分类与双渠道择优路由
- Phase 1000 added after Phase 16: Curriculum 结构化证据契约与 Semester Facts 修复
- Phase 10.1 inserted after Phase 10: Official Web Current Truth Closeout And Fresh News Surface Handoff (URGENT)
- Phase 10.2 added after Phase 10.1: Official Web Release Gate Dataset Quality Improvement
- Phase 10.3 added after Phase 10.2: Official Web Release Gate Chunk Cleanup And Header Normalization
- Phase 10.4 added after Phase 10.3: Official Web Corpus Split Routing And Stable Reference Bootstrap
- Phase 10.5 added after Phase 10.4: Official Web Stable Reference Release Evidence And Serving Surface Cleanup
- Phase 13 added after Phase 12.2: 政治风险判定与幻觉控制硬化
- Phase 14 added after Phase 13: 产品主链路 Prompt Stack 与 System Prompt Runtime 收口
- Phase 1001 added after Phase 1000: Campus Navigation Place Catalog Expansion And Acceptance Evidence

### Decisions

Decision history now lives in `PROJECT.md` Key Decisions。
这里只保留当前执行面需要重复消费的 delta：

- Phase 15 `幻觉治理与 Grounded Generation 二次硬化` 已完成 repo-local closeout；当前 repo 不再把它视为 active execution lane
- Phase 16 已冻结为新的 planning lane：先做 raw asset typing / routing contract，再决定 MinerU 的条件式 canonical scope
- Phase 16 已完成 closeout：raw asset registration 已支持 typed metadata，compare lane 现已输出 `asset_typing` / `routing_recommendation`，`source_truth_only` canonical lane 现已同时支持 typed PDF 的 `MinerU primary -> Paddle fallback` 与 `generic_image` 的 Paddle+MinerU 双跑判型；canonical scope 已冻结为 `pdf -> MinerU primary`、`simple_table_image -> Paddle primary`、`complex_table_image -> MinerU primary`、`spatial/office -> deferred`
- Cohort A `institutional_regulations` formal import 当前只允许消费 vetted notice-id 白名单；更宽的 `internal_notice` formal current scope 仍存在未验收 promote/hold/manual-review 混合 posture，不能直接做 unfiltered target materialization
- ADR-0040 的下一条 implementation slice 已在当前 worktree 落地：`document_id` 现由 `regulation_work_title + issuing_org + semantic_scope` 派生，projected/materialized `title` 现默认使用 `regulation_display_title`；`regulation_title_normalized` 与 `source_title_literal` 继续保留为 source-facing title metadata
- 2026-04-14 已完成 regulation lane 的受控 replay/rematerialization，并随后完成 `355282` 的 bounded formalization：Cohort A formal local current-scope refresh 已先把现有本地 target rows 补齐到当前 title/version metadata truth；之后 `355282` 又通过 source-truth repair + targeted source projection rebuild + filtered materialization 正式进入当前 target
- 2026-04-14 已进一步冻结 regulation display-title 语义：`regulation_display_title` 固定保留完整 `regulation_edition_label`，例如 `2026版`、`2026年修订`；当前不接受把 display-title 压成裸年份 `2026`
- 2026-04-14 已完成 `351119 / 中央民族大学差旅费管理办法（民大校发〔2025〕104号）` 的 GSD blocker 澄清：当前阻塞不只是 `file_release_backed_regulation_body_missing`，还包括 repo 内无对应 `file_release` export/source bytes，且 regulation lane 尚无 `file_release -> owner body recovery` downstream consumer；下次认证窗口必须先做 bounded `file_release` capture，再补 bounded consumer
- 2026-04-14 已为 regulation lane 补齐 bounded `file_release` downstream readiness contract：repo 现可读取 `file_release` bundle / manifest，并对 `owner_title_hint` 返回 `ready / missing_capture / missing_source_bytes / ambiguous_match`；当前这仍不是 owner body recovery，也不会自动改写 promotion/materialization
- 2026-04-14 已冻结当前已采集 regulation corpus 的 offline inventory：当前 `16` 条 notice family 中，`11` 条已进入 formal local current target，`355282` 已从 isolated sample 提升为 attachment-backed `accepted_current_target`，`191177` 继续 duplicate hold，`351119` 继续 auth-blocked，`351699 / 351704 / 177880` 保持非当前 regulation target follow-up
- Phase 1000 `1000-01` 与 `1000-02` 的当前有效结论已更新：canonical/source-unit evidence contract 已冻结，`课程设置` / `修读建议` 继续走 `curriculum_lookup` 非 procedure 路径；`课程地图` 已因真实 OCR 抽样证据不足被收回当前业务范围，runtime 现已对这类 query fail-close，不再进入 retrieval/support selection
- Phase 1000 `1000-03` 已完成：`program_semester_facts` 现已改为 position-preserving table normalization，`大学英语(四)` 类 sparse-row data loss 已有 deterministic coverage，worker/local-rebuild 也已支持按 canonical `source_document_id` 做 targeted rematerialization
- Phase 1000 `1000-04` 已完成：raw retrieved candidates 与 final supporting evidence 现已在 supervisor / eval / app-api / operator 全链路拆分；targeted rematerialization 已配合 fresh `program_semester_facts` publish release `r20260413_042533` 完成，curriculum live accept artifact 已刷新为 `.tmp/evals/curriculum-plan-live-gate-accept-phase1000/`
- `docs/plans/post-closeout-follow-up-execution-plan.md` 已转为 deferred reference：Wave A/B/D/E 主体完成，Wave C 只剩 switched-provider historical artifact replacement rerun
- Phase 1001 `1001-01` 已完成：官方 map / campus-tour authoritative source inventory、first-batch candidate inventory、`seed_ready` vs `park_pending_geometry` admission posture，以及 clarification-first ambiguity family 现已 repo-tracked
- Phase 1001 `1001-02` 已完成：`place_catalog` 现已接受 nullable geometry posture，first-batch seed 已从 `7` 条扩到 `12` 条；generic `图书馆` 现会 clarification-first，campus-qualified alias 保持 direct completion，official-label-backed row 即使无 point geometry 也能稳定产出 place truth
- 2026-04-14 已新增 backlog `999.2`：地图实际上线前，不把 `place_card` / map consumption 或 staging/manual acceptance 继续写成当前执行项；当前 supervisor 产品路径已对 `place_lookup` fail-close
- Phase 14 `Prompt Stack / System Prompt Runtime` closeout 已在当前 worktree 落地；在合入 `develop` 前，它仍是 worktree-local progress
- staging baseline 已固定为 `campus-api-staging.ayafeed.com`、`campus-chat-staging.ayafeed.com`、`campus-panel-staging.ayafeed.com` 三个项目隔离一级子域；Wave B chat/panel/Sentry 证据保留为回归基线，而不是当前 open lane
- `official_web/fresh_news` / `official_web/news_archive` opening policy 继续留在独立 official-web worktree，不在当前执行面混入
- 2026-04-14 已关闭 Phase 1002 `Worker 部署与发布硬化收口` 的 repo-level implementation：shared `staging-release.mjs`、`run-worker-staging-preflight.mjs`、三端 deploy/test 更新，以及 staging deploy / observability runbook 已全部对齐
- 2026-04-14 已关闭 Phase 1003 `Official Web 新闻面 opening policy 与 runtime gate 收口` 的 repo-level implementation：news opening policy docs、runtime-profile contract、query-boundary tests 与 independent-worktree opening checklist 已全部对齐
- 2026-04-14 已新增 backlog `999.4`：`official_web/fresh_news` / `official_web/news_archive` 的 opening execution / acceptance 明确降级为 deferred lane，恢复前不再视为当前 active workstream 集合的一部分
- 2026-04-18 已把 planning 执行面改为 workstream-first 多线模型：`.planning/STATE.md` 不再假定 repo 只有一条全局 active lane；各会话默认只更新自己推进的 workstream 条目
- 2026-04-18 已将 shared product surfaces acceptance / hardening 注册为当前 active product workstream：`apps/app-api`、`apps/public-chat-web`、`apps/protected-panel-web` 必须按 `app-api -> public-chat-web -> protected-panel-web -> integrated acceptance -> staging closeout` 顺序推进，同一 workstream 内不再并发
- 2026-04-18 已将 authenticated-notice 数据面 follow-up 拆成两条 workstream：非认证的 `authenticated-notice -> regulation downstream consumption` 只负责已捕获 corpus 的 admitted regulation / `scoped_rules` downstream hardening；需要认证窗口的 `authenticated-notice file_release owner recovery` 单独承接 `351119` 的 targeted capture、owner body recovery 与回接 promotion/materialization
- 2026-04-19 已冻结 `authenticated-notice live portal / authenticated control-plane` 为单条 deferred workstream：repo-native authenticated collector、live `notice` / `file_release` capture、scheduler/incremental sync、run ledger 与 source-channel control-plane 都只作为顺序子层推进；恢复前继续保持 deferred
- 2026-04-18 已冻结 `product-path safety / prompt / grounding governance` 为单条 active workstream：`敏感问题拦截`、`system prompt`、`grounding runtime`、`eval/operator artifact refresh` 都只作为顺序子层推进；当前前向切片是 live artifact rerun replacement 与持续 release-gate 治理
- 2026-04-19 已冻结 `operator observability / control-plane` 为单条 deferred workstream：request-scoped observability fact、audit/quality/safety/cost read model、panel 新域与 sink participation 都只作为顺序子层推进；恢复前继续保持 deferred
- 2026-04-18 已冻结 `restricted document rollout / verification` 为单条 deferred workstream：restricted collection rollout、public/operator/service surface behavior、allow/deny matrix 与 leakage-hardening evidence 都只作为顺序子层推进；恢复前继续保持 deferred
- 2026-04-18 已冻结 `campus navigation rollout / place_card / map consumption` 为单条 deferred workstream：地图上线后的 `place_lookup` 恢复、`place_card` / map consumption 与 staging/manual acceptance 都只作为顺序子层推进；恢复前继续停在 backlog `999.2`
- 2026-04-18 已冻结 `official-web source channel / news opening` 为单条 deferred workstream：`source/control-plane follow-up`、`stable_reference` maintenance、`fresh_news` opening、`news_archive` opening 与 acceptance closeout 都只作为顺序子层推进；恢复前继续停在 backlog `999.4`

### Pending Todos

- 推进 `authenticated-notice -> regulation downstream consumption` 的会话，统一以 `docs/plans/internal-notice-policy-regulation-consumption-implementation.md` 为唯一入口；当前只处理已捕获 corpus 的 admitted regulation / `scoped_rules` downstream hardening，不再混入 auth-window `file_release` capture
- 上述 non-auth regulation downstream workstream 的近端 follow-up 已登记为 `.planning/todos/pending/2026-04-18-internal-notice-legacy-office-downstream-metadata-truth.md`；固定顺序是 `文档真相刷新 -> legacy Office normalization contract -> worker-owned normalizer/provenance -> 可盘点 fail-close/backlog 语义`，不扩到 auth owner recovery 或 query-serving reopen
- 推进 `authenticated-notice file_release owner recovery` 的会话，统一以 `docs/plans/authenticated-notice-file-release-owner-recovery.md` 为唯一入口；固定顺序保持 `auth-window targeted capture -> source-byte verification -> owner body recovery -> promotion/materialization re-entry -> bounded validation`
- 如果认证窗口恢复或产品决定重开 authenticated source-channel live portal / control-plane，统一以 `docs/plans/authenticated-notice-live-portal-control-plane.md` 为唯一入口；恢复后固定顺序保持 `collector runtime/repo migration truth refresh -> auth bootstrap/live capture policy/scheduling -> run ledger/artifact refs/auth readiness -> live-historical reconcile -> operator control-plane/bounded APIs -> planning closeout`
- 推进 `product-path safety / prompt / grounding governance` 的会话，统一以 `docs/plans/archive/completed/hallucination-governance-and-grounded-generation-execution-plan.md` 为唯一入口；不再拆成敏感问题拦截 / system prompt / grounding / eval artifact 多条并发线
- 推进 `shared product surfaces acceptance / hardening` 的会话，统一以 `docs/plans/archive/completed/shared-product-surfaces-acceptance-hardening.md` 为唯一入口；固定顺序保持 `app-api -> public-chat-web -> protected-panel-web -> integrated acceptance -> staging closeout`
- 当 `shared product surfaces` workstream 进入 Phase E 时，按新的 `deploy:preflight:staging` / release-scoped evidence contract 执行真实 deploy closeout
- 如果产品范围决定恢复 operator observability / control-plane，统一以 `docs/plans/operator-observability-control-plane-foundation.md` 为唯一入口；恢复后固定顺序保持 `request-scoped observability foundation -> audit projection -> metric rollup/APIs -> panel domain expansion -> sink participation/grading backflow -> planning closeout`
- 如果产品范围决定恢复 restricted rollout，统一以 `docs/plans/restricted-document-rollout-and-verification.md` 为唯一入口；恢复后固定顺序保持 `authorization/release posture -> restricted collection rollout -> surface behavior -> verification/leakage hardening -> planning closeout`
- 如果校园地图实际上线、导航产品路径需要恢复，统一以 `docs/plans/campus-navigation-rollout-map-consumption.md` 为唯一入口；恢复后固定顺序保持 `map-launch preconditions -> place_lookup runtime recovery -> place_card/map consumption -> staging/manual acceptance -> planning closeout`
- 如果 `official_web` 新闻面后续重新进入产品优先级，统一以 `docs/plans/official-web-source-channel-news-opening.md` 为唯一入口；恢复后固定顺序保持 `source/control-plane -> stable_reference maintenance -> fresh_news opening -> news_archive opening -> acceptance closeout`
- 等待地图实际上线后，再从 backlog `999.2` promote 导航产品路径、`place_card` / map consumption 与 staging/manual acceptance

### Blockers/Concerns

- 当前 active workstreams 已无共享 repo-internal blocker
- authenticated-notice 的 live portal / authenticated control-plane 当前不是 blocker，而是明确保持 `deferred` 的 source-channel 后续线；恢复前不再默认占用 active workstream 优先级
- 校内导航当前不是 blocker，而是显式关闭的产品能力；重新开启以地图上线为前提，不再按“尚未补证据”处理
- operator observability 扩面当前不是 blocker，而是明确保持 `deferred` 的 operator/product 后续线；恢复前不再默认占用 active workstream 优先级
- restricted rollout 当前不是 blocker，而是明确保持 `deferred` 的产品/授权后续线；恢复前不再默认占用 active workstream 优先级
- `official_web` 新闻面 opening execution 当前不是 blocker，而是 backlog `999.4` 中的 deferred lane；恢复前不再默认占用 active workstream 优先级
- MinerU 仍不是全局 canonical OCR provider；当前冻结结论只允许它在 typed PDF 与 refined complex-table image 上担任 canonical primary
- curriculum historical artifact replacement 当前只剩归档 / pointer 整理，不再有 provider contract blocker
- panel 后续工作必须继续经由 `apps/app-api` owned surfaces，不能回退到 panel-side synthesis、audit log 直读或基础设施直读
- `Jobs` / `Operations` / `Audit` 继续不进入默认 rollout，除非产品范围重新开启

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 260414-bsz | 修复 `355282` 的 source projection 缺口并将其正式并入 local regulation target | 2026-04-14 | worktree | [260414-bsz-regulation-355282-formal-local-target](./quick/260414-bsz-regulation-355282-formal-local-target/) |
| 260414-ang | 冻结已采集 regulation corpus 的离线 inventory 与 blocked frontier，作为无认证态下的后续工作入口 | 2026-04-14 | worktree | [260414-ang-regulation-corpus-inventory-blocked-fron](./quick/260414-ang-regulation-corpus-inventory-blocked-fron/) |
| 260414-9vu | 为 regulation lane 补 file_release owner-recovery readiness contract，并以定向测试冻结 matching/readiness 状态 | 2026-04-14 | worktree | [260414-9vu-regulation-lane-file-release-owner-recov](./quick/260414-9vu-regulation-lane-file-release-owner-recov/) |
| 260414-96b | 澄清 `351119` regulation 导入的 file-release blocker，并冻结下一条 bounded owner-recovery implementation slice | 2026-04-14 | worktree | [260414-96b-regulation-file-release-owner-recovery](./quick/260414-96b-regulation-file-release-owner-recovery/) |
| 260414-c2p | 冻结 regulation display-title 的完整版次标签格式，并补回归测试锁住 `版次/修订/暂行/届别/文号` 边界 | 2026-04-14 | worktree | [260414-c2p-regulation-display-title-format](./quick/260414-c2p-regulation-display-title-format/) |
| 260414-8rt | 完成 regulation lane 的定向 replay/rematerialization，并把 ADR-0040 的 title/version identity 真正落到本地 regulation target | 2026-04-14 | worktree | [260414-8rt-regulation-replay-rematerialization](./quick/260414-8rt-regulation-replay-rematerialization/) |
| 260414-8sd | 切换 regulation target 到 work-title identity，并把 projected/materialized title 收口到 display_title | 2026-04-14 | worktree | [260414-8sd-regulation-work-title-identity-cutover](./quick/260414-8sd-regulation-work-title-identity-cutover/) |
| 260414-81f | 为 regulation 标题/年份版本分离落地 non-breaking split metadata，并补 planning/docs 验收真相 | 2026-04-14 | worktree | [260414-81f-regulation-title-version-split-fields](./quick/260414-81f-regulation-title-version-split-fields/) |
| 260414-7jt | 冻结 regulation 文档标题/年份版本 双层 identity contract，并补 current truth 与 approved target 的文档分层 | 2026-04-14 | worktree | [260414-7jt-regulation-identity-contract](./quick/260414-7jt-regulation-identity-contract/) |
| 260412-k7s | 完成 internal_notice -> institutional_regulations 的 isolated local-only materialization 验收，并更新 docs/state 真相 | 2026-04-12 | worktree | [260412-k7s-internal-notice-institutional-regulation](./quick/260412-k7s-internal-notice-institutional-regulation/) |
| 260412-jre | 刷新 institutional_regulations Cohort A 的 local-only target chunk acceptance，并收口剩余 manual-review 范围 | 2026-04-12 | worktree | [260412-jre-institutional-regulations-target-collect](./quick/260412-jre-institutional-regulations-target-collect/) |
| 260412-j1s | 冻结 authenticated_notice file_release 导出契约与认证窗口执行 runbook | 2026-04-12 | worktree | [260412-j1s-authenticated-notice-file-release-runboo](./quick/260412-j1s-authenticated-notice-file-release-runboo/) |
| 260412-1qs | 为 authenticated_notice source-truth/import 补 owner expectation recovery contract | 2026-04-12 | worktree | [260412-1qs-full-research-authenticated-notice-sourc](./quick/260412-1qs-full-research-authenticated-notice-sourc/) |
| 260412-1c5 | 为 internal_notice regulation promotion 补充 semantic owner metadata 与 owner-missing contract | 2026-04-12 | worktree | [260412-1c5-full-research-internal-notice-regulation](./quick/260412-1c5-full-research-internal-notice-regulation/) |
| 260411-ouc | 完成 internal_notice regulation candidate 的 local-only target-side chunk prep 与质量验收 | 2026-04-11 | worktree | [260411-ouc-internal-notice-regulation-candidate-loc](./quick/260411-ouc-internal-notice-regulation-candidate-loc/) |
| 260411-ocm | 实现 internal_notice promotion candidate artifact contract 并完成 local-only 导出验收 | 2026-04-11 | worktree | [260411-ocm-internal-notice-promotion-candidate-arti](./quick/260411-ocm-internal-notice-promotion-candidate-arti/) |
| 260411-ptg | 完成 institutional_regulations Cohort A target-side batch acceptance 并冻结 manual-review 分布 | 2026-04-11 | worktree | [260411-ptg-institutional-regulations-cohort-a-targe](./quick/260411-ptg-institutional-regulations-cohort-a-targe/) |
| 260411-pzz | 完成 institutional_regulations structure-aware short-fragment merge tuning 并收口 Cohort A rerun | 2026-04-11 | worktree | [260411-pzz-institutional-regulations-structure-awar](./quick/260411-pzz-institutional-regulations-structure-awar/) |
| 260411-rho | 校正 institutional_regulations promotion adjudication taxonomy 并重评 Cohort A manual-review 理由 | 2026-04-11 | worktree | [260411-rho-institutional-regulations-promotion-adju](./quick/260411-rho-institutional-regulations-promotion-adju/) |
| 260411-s54 | 冻结 notice-derived annual-cycle 与 temporary-operation 文档的 collection boundary | 2026-04-11 | worktree | [260411-s54-notice-derived-annual-cycle-and-temporar](./quick/260411-s54-notice-derived-annual-cycle-and-temporar/) |
| 260411-qfc | 冻结 internal notice manual-review buckets 的 future query contract 与 reopen 前置条件 | 2026-04-11 | worktree | [260411-qfc-internal-notice-manual-review-future](./quick/260411-qfc-internal-notice-manual-review-future/) |
| 260411-sru | 冻结 unified scoped_rules holding collection，并把 import-first 作为 scoped-rule 当前策略 | 2026-04-11 | worktree | [260411-sru-unified-scoped-rules-holding-collectio](./quick/260411-sru-unified-scoped-rules-holding-collectio/) |
| 260411-u0t | 补齐 scoped_rules materialization 与定向验证，打通 manual bucket 到 holding collection 的 repo-local 路径 | 2026-04-11 | worktree | [260411-u0t-scoped-rules-materialization](./quick/260411-u0t-scoped-rules-materialization/) |
| 260411-w5m | 完成 scoped_rules local-only chunk acceptance，并冻结 isolated snapshot root operator rule | 2026-04-11 | worktree | [260411-w5m-scoped-rules-quality-acceptance](./quick/260411-w5m-scoped-rules-quality-acceptance/) |
| 260411-pbp | 收口 historical donor local-smoke routing mismatch 并把 blob-root 依赖改成 import fast-fail | 2026-04-11 | worktree | [260411-pbp-historical-donor-local-smoke-routing-mis](./quick/260411-pbp-historical-donor-local-smoke-routing-mis/) |
| 260411-r4m | 收口 internal_notice Wave D guarded release 文档与 no-proxy operator 规则 | 2026-04-11 | worktree | [260411-r4m-internal-notice-wave-d-guarded-release](./quick/260411-r4m-internal-notice-wave-d-guarded-release/) |
| 260411-n9q | 修复 internal_notice promotion 的 source_notice_release_time 透传并完成本地验收 | 2026-04-11 | worktree | [260411-n9q-internal-notice-promotion-source-notice-](./quick/260411-n9q-internal-notice-promotion-source-notice-/) |
| 260411-mpt | 完成 public-chat-web donor tech-debt convergence Wave 5 本地 closeout | 2026-04-11 | worktree | [260411-mpt-public-chat-web-donor-tech-debt-converge](./quick/260411-mpt-public-chat-web-donor-tech-debt-converge/) |
| 260411-mlz | 为《中央民族大学采购工作管理办法》完成 promotion-side wrapper stripping 与 cleanup pilot | 2026-04-11 | worktree | [260411-mlz-internal-notice-promotion-side-wrapper-s](./quick/260411-mlz-internal-notice-promotion-side-wrapper-s/) |
| 260411-mbr | 完成 internal notice《中央民族大学采购工作管理办法》单文档 local-only chunk-prep pilot | 2026-04-11 | worktree | [260411-mbr-internal-notice-local-only-chunk-prep-pi](./quick/260411-mbr-internal-notice-local-only-chunk-prep-pi/) |
| 260411-lxl | 收口 authenticated-notice promotion 下一执行切片与 manual-review taxonomy | 2026-04-11 | worktree | [260411-lxl-authenticated-notice-promotion-chunk-pre](./quick/260411-lxl-authenticated-notice-promotion-chunk-pre/) |
| 260410-5yl | 冻结 internal notice policy/regulation Cohort A/B/C 并完成本地质量 pilot | 2026-04-10 | b1b5150 | [260410-5yl-internal-notice-policy-regulation-cohort](./quick/260410-5yl-internal-notice-policy-regulation-cohort/) |
| 260410-4zq | 将本地开发数据库迁移到 local Postgres 并完成 Wave D 本地闭环 | 2026-04-10 | b253bb8 | [260410-4zq-postgres-shared-supabase-wave-d](./quick/260410-4zq-postgres-shared-supabase-wave-d/) |

## Recent Verification

- 2026-04-18 `shared product surfaces` local baseline:
  - `pnpm --dir apps/app-api typecheck`
  - `pnpm --dir apps/app-api test`
  - `pnpm --dir apps/app-api test:worker`
  - `pnpm --dir apps/app-api test:shared-db-integration`
  - `pnpm --dir apps/public-chat-web typecheck`
  - `pnpm --dir apps/public-chat-web test:worker`
  - `pnpm --dir apps/public-chat-web build`
  - `pnpm --dir apps/protected-panel-web typecheck`
  - `pnpm --dir apps/protected-panel-web test:worker`
  - `pnpm --dir apps/protected-panel-web build`
- `uv run --all-packages python -m unittest tests.ingestion.test_authenticated_notice_source_projections.AuthenticatedNoticeSourceProjectionsTest.test_rebuild_authenticated_notice_source_projections_notice_id_filter_keeps_unselected_scope_rows tests.ingestion.test_rebuild_authenticated_notice_source_projections_worker`
- `uv run --all-packages python -m unittest tests.ingestion.test_authenticated_notice_source_projections.AuthenticatedNoticeSourceProjectionsTest.test_rebuild_authenticated_notice_source_projections_replaces_scope_and_materializes_attachment_children tests.ingestion.test_authenticated_notice_source_projections.AuthenticatedNoticeSourceProjectionsTest.test_rebuild_authenticated_notice_source_projections_reuses_ocr_result_for_shared_pdf_payloads`
- `uv run --all-packages python .planning/quick/260414-bsz-regulation-355282-formal-local-target/formalize_355282_local.py`
- `jq '{before_target_count, after_target_count, source_rows_after_projection, writes_embeddings, writes_qdrant, writes_release_manifests, writes_aliases}' .planning/quick/260414-bsz-regulation-355282-formal-local-target/run-output/formalization-summary.json`
- `uv run --all-packages python - <<'PY' ...` to read local `regulations/institutional_regulations` current scope and confirm `current_target_count=11`, `document_id=institutional_regulation:muc:中央民族大学关于学生使用人工智能的指导意见:089bcf7907da`, `title=中央民族大学关于学生使用人工智能的指导意见 / 2026版`, `semantic_owner_kind=attachment_document`
- `uv run --all-packages python -m unittest tests.specialist.test_rag_specialist tests.evals.test_curriculum_live_benchmark`
- `uv run --all-packages python -m unittest tests.ingestion.test_internal_notice_regulation_promotion tests.ingestion.test_internal_notice_regulation_projection tests.ingestion.test_internal_notice_regulation_materialization tests.ingestion.test_materialize_internal_notice_regulation_worker`
- `uv run --all-packages python -m unittest tests.supervisor.test_supervisor_core.SupervisorCoreTest.test_build_supervisor_observability_keeps_raw_retrieved_sources_separate_from_supporting_sources tests.supervisor.test_supervisor_core.SupervisorCoreTest.test_build_supervisor_observability_does_not_mirror_supporting_sources_for_clarification tests.supervisor.test_supervisor_core.SupervisorCoreTest.test_build_supervisor_observability_marks_course_map_fail_close_as_no_retrieval tests.evals.test_runtime_observability tests.evals.test_curriculum_live_benchmark`
- `pnpm --dir apps/app-api exec vitest run test/request-observability.test.ts test/operator-query.route.test.ts test/operator-query.service.test.ts`
- `uv run --all-packages python -m unittest tests.contracts.test_models tests.ingestion.test_curriculum_program_semester_facts_projection tests.ingestion.test_curriculum_program_semester_facts_materialization tests.ingestion.test_materialize_curriculum_program_semester_facts_worker tests.ingestion.test_rebuild_local_data tests.retrieval.test_curriculum_query_resolution tests.retrieval.test_backend_qdrant tests.specialist.test_rag_specialist tests.evals.test_golden_cases tests.evals.test_runtime_observability tests.evals.test_curriculum_live_benchmark`
- `uv run --package campus-ingestion-worker python -m campus_ingestion_worker.materialize_curriculum_program_semester_facts --source-document-id "curriculum:法学（民族实验班）本科人才培养方案" --source-document-id "curriculum:历史学（强基计划）本科人才培养方案"`
- `set -a && source .env >/dev/null 2>&1 && set +a && env HTTP_PROXY= HTTPS_PROXY= ALL_PROXY= http_proxy= https_proxy= all_proxy= NO_PROXY='*' no_proxy='*' uv run --package campus-ingestion-worker python -m campus_ingestion_worker.release_registry_scope --corpus curriculum --collection program_semester_facts --publish-alias`
- `set -a && source .env >/dev/null 2>&1 && set +a && env UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m campus_evals.curriculum_live_benchmark accept --reruns 3 --verbose --log-jsonl .tmp/evals/curriculum-runtime-events-phase1000.jsonl --output-dir .tmp/evals/curriculum-plan-live-gate-accept-phase1000`
- `uv run --all-packages python .planning/quick/260412-k7s-internal-notice-institutional-regulation/materialize_institutional_regulations_local_only.py`
- `uv run --all-packages python -m py_compile packages/ingestion-core/src/campus_ingestion_core/raw_ingestion.py`
- `uv run --all-packages python -m unittest tests.ingestion.test_internal_notice_regulation_materialization tests.ingestion.test_materialize_internal_notice_regulation_worker`
- `uv run --all-packages python -m unittest tests.ingestion.test_online_ocr_compare tests.ingestion.test_compare_online_ocr_worker`
- `uv run --all-packages campus-ingestion-compare-online-ocr --file-path .tmp/auth-cookie4-runtime/pdf-policy-samples-20260409/351896-attachment-01.pdf --output-dir .tmp/ocr-compare-batch/20260412-phase16-validation/pdf-351896-paddle-candidate`
- `set -a; source .env.mineru.compare; set +a; uv run --all-packages campus-ingestion-compare-online-ocr --file-path .tmp/notice-351886-images/attachment-0002.png --baseline-provider-response-path .tmp/ocr-compare-batch/20260412-round3/img-notice-contact-0002-retry/paddle/provider-response.jsonl --output-dir .tmp/ocr-compare-batch/20260412-phase16-validation/img-notice-contact-0002-mineru-candidate`
- `uv run --all-packages python -m unittest tests.ingestion.test_register_raw_asset tests.ingestion.test_registry_models tests.ingestion.test_process_raw_ingestion_job tests.test_environment_layout`
- `pnpm --dir apps/app-api exec vitest run test/request-diagnostics.test.ts test/request-observability.test.ts test/operator-query.route.test.ts test/operator-query.service.test.ts test/supervisor-adapter.test.ts`
- `pnpm --dir apps/app-api exec vitest run test/projection.service.test.ts`
- `pnpm --dir apps/app-api exec tsc -p tsconfig.json --noEmit`
- `uv run --all-packages --no-sync python -m unittest tests.evals.test_golden_cases tests.evals.test_runtime_observability tests.evals.test_curriculum_live_benchmark`
- `pnpm --dir apps/app-api exec vitest run test/request-observability.test.ts test/supervisor-adapter.test.ts test/operator-query.route.test.ts test/chat-command.service.test.ts test/chat-requests.route.test.ts test/operator-query.service.test.ts test/shared-database-adoption.test.ts`
- `pnpm --dir apps/app-api exec tsc --noEmit`
- `uv run --all-packages --no-sync python -m unittest tests.contracts.test_models tests.evals.test_runtime_observability tests.evals.test_curriculum_live_benchmark tests.supervisor.test_supervisor_core tests.supervisor.test_supervisor_policy tests.specialist.test_rag_specialist tests.api.test_supervisor_api tests.api.test_supervisor_api_prompt_stack`
- `pnpm --dir apps/app-api db:bootstrap`
- `curl -sf http://127.0.0.1:8081/readyz`
- `curl -sf http://127.0.0.1:5173/readyz`
- `pnpm --dir apps/public-chat-web typecheck`
- `pnpm --dir apps/public-chat-web exec vitest run test/public-chat-router-cutover.test.ts test/chatbot-vendor-runtime-parity.test.ts test/public-chat-donor-diff-whitelist.test.ts test/public-chat-donor-diff-classification.test.ts`
- `pnpm --dir apps/public-chat-web test:worker`
- `pnpm --dir apps/public-chat-web build`
- `Playwright MCP local smoke: /login -> /chat -> first send -> reload` with evidence at `.tmp/local-smoke/20260411T163903+0800-public-chat-wave5-closeout/`
- `uv run --all-packages python -m unittest tests.ingestion.test_internal_notice_regulation_promotion tests.ingestion.test_build_internal_notice_regulation_promotion_manifest_worker tests.ingestion.test_collection_config tests.ingestion.test_corpus_runtime_profile`
- `uv run --all-packages python -m unittest tests.ingestion.test_internal_notice_regulation_promotion tests.ingestion.test_authenticated_notice_import tests.ingestion.test_authenticated_notice_source_truth_inventory`
- `uv run --all-packages python -m unittest tests.ingestion.test_internal_notice_regulation_promotion tests.ingestion.test_export_internal_notice_regulation_candidate_artifacts_worker`
- `uv run --all-packages python -m unittest tests.ingestion.test_internal_notice_regulation_promotion`
- `uv run --all-packages python -m unittest tests.ingestion.test_internal_notice_regulation_promotion tests.ingestion.test_export_internal_notice_regulation_candidate_artifacts_worker tests.ingestion.test_internal_notice_regulation_materialization tests.ingestion.test_internal_notice_regulation_candidate_chunk_prep tests.ingestion.test_prepare_internal_notice_regulation_candidate_chunks_worker tests.ingestion.test_internal_notice_regulation_projection tests.ingestion.test_processing_pipeline tests.test_workspace_layout`
- `uv run --all-packages python .planning/quick/260411-ptg-institutional-regulations-cohort-a-targe/cohort_a_target_chunk_acceptance.py --output-dir .planning/quick/260412-jre-institutional-regulations-target-collect/rerun-output`
- `uv run --all-packages python .planning/quick/260411-ptg-institutional-regulations-cohort-a-targe/cohort_a_target_chunk_acceptance.py --output-dir .planning/quick/260411-rho-institutional-regulations-promotion-adju`
- `python - <<'PY' ...` to assert ADR-0036, manual-review collection strategy, and quick-task closeout artifacts exist
- `rg -n "document age is not a standalone exclusion|dedicated semantic-owner surface" docs configs .planning -S`
- `uv run --all-packages python -m unittest tests.ingestion.test_authenticated_notice_import tests.ingestion.test_internal_notice_regulation_promotion tests.ingestion.test_export_internal_notice_regulation_candidate_artifacts_worker`
- `uv run --all-packages python -m unittest tests.ingestion.test_authenticated_notice_import`
- `uv run --all-packages python .planning/quick/260411-ptg-institutional-regulations-cohort-a-targe/cohort_a_target_chunk_acceptance.py`
- `uv run --all-packages python - <<'PY' ...` to inspect Cohort A promotion routing distribution from rebuilt inventory and confirm `candidate_count=1`, `manual_review_count=10`, `notice_id=187233` is the only current `promote_candidate`
- `uv run --all-packages python -m unittest tests.ingestion.test_internal_notice_regulation_promotion tests.ingestion.test_export_internal_notice_regulation_candidate_artifacts_worker tests.ingestion.test_internal_notice_regulation_materialization tests.ingestion.test_internal_notice_regulation_candidate_chunk_prep tests.ingestion.test_prepare_internal_notice_regulation_candidate_chunks_worker`
- `uv run --all-packages python .planning/quick/260411-mlz-internal-notice-promotion-side-wrapper-s/pilot_187233_wrapper_cleanup.py`
- `uv run --all-packages python - <<'PY' ...` to rebuild `187233` source-truth inventory entry from local-smoke source artifacts and confirm promotion report now resolves `source_notice_release_time=2021-02-28 16:09` with `missing_required_metadata=[]`
- `uv run --all-packages python - <<'PY' ...` to rebuild `187233` source-truth inventory from local-smoke source artifacts and export local-only candidate artifacts under `.planning/quick/260411-ocm-internal-notice-promotion-candidate-arti/`, confirming `exported_candidate_count=1` and candidate markdown carries `source_notice_release_time=2021-02-28 16:09`
- `uv run --package campus-ingestion-worker python -m campus_ingestion_worker.export_internal_notice_regulation_candidate_artifacts --documents-json .tmp/historical-intake/run14-policy-regulation-expanded/local-smoke/registry/documents.json --source-truth-inventory-json .planning/quick/260411-ouc-internal-notice-regulation-candidate-loc/rebuilt-source-truth-inventory.json --object-store-root .tmp/historical-intake/run14-policy-regulation-expanded/local-smoke/object-store --output-dir .planning/quick/260411-ouc-internal-notice-regulation-candidate-loc/candidate-export-rebuilt --notice-id 187233`
- `uv run --package campus-ingestion-worker python -m campus_ingestion_worker.prepare_internal_notice_regulation_candidate_chunks --candidate-documents-jsonl .planning/quick/260411-ouc-internal-notice-regulation-candidate-loc/candidate-export-rebuilt/candidate-documents.jsonl --output-dir .planning/quick/260411-ouc-internal-notice-regulation-candidate-loc/chunk-prep-rebuilt`
- `uv run --package campus-ingestion-worker python -m campus_ingestion_worker.prepare_internal_notice_regulation_candidate_chunks --candidate-documents-jsonl .planning/quick/260411-ouc-internal-notice-regulation-candidate-loc/candidate-export/candidate-documents.jsonl --output-dir .planning/quick/260411-ouc-internal-notice-regulation-candidate-loc/chunk-prep-stale-inventory`
- `uv run --all-packages python .planning/quick/260411-ptg-institutional-regulations-cohort-a-targe/cohort_a_target_chunk_acceptance.py --output-dir .planning/quick/260411-pzz-institutional-regulations-structure-awar`
- `uv run --all-packages python -m unittest tests.ingestion.test_internal_notice_scoped_rule_materialization tests.ingestion.test_internal_notice_scoped_rule_chunk_prep tests.ingestion.test_materialize_internal_notice_scoped_rules_worker tests.ingestion.test_prepare_scoped_rule_chunks_worker`
- `uv run --all-packages python .planning/quick/260411-w5m-scoped-rules-quality-acceptance/scoped_rules_local_chunk_acceptance.py`
- `uv run --all-packages python -m unittest tests.ingestion.test_campusrag_ingestion_support tests.ingestion.test_internal_notice_scoped_rule_materialization tests.ingestion.test_internal_notice_scoped_rule_chunk_prep tests.ingestion.test_prepare_scoped_rule_chunks_worker tests.ingestion.test_materialize_internal_notice_scoped_rules_worker tests.ingestion.test_collection_config tests.ingestion.test_corpus_runtime_profile`
- `uv run --all-packages python .planning/quick/260411-uej-scoped-rules-local-only-chunk-prep/scoped_rules_local_chunk_acceptance.py --adjudication-path .planning/quick/260411-rho-institutional-regulations-promotion-adju/manual-review-adjudication.json --local-smoke-root .tmp/historical-intake/run14-policy-regulation-expanded/local-smoke --output-dir .planning/quick/260411-uej-scoped-rules-local-only-chunk-prep`
- `uv run --package campus-ingestion-worker python -m campus_ingestion_worker.build_internal_notice_regulation_promotion_manifest --documents-json .tmp/historical-intake/run14-policy-regulation-expanded/local-smoke/registry/documents.json --source-truth-inventory-json .tmp/historical-intake/run14-policy-regulation-expanded/local-smoke/registry/source-truth-inventory.json --object-store-root .tmp/historical-intake/run14-policy-regulation-expanded/local-smoke/object-store --notice-id 187233`
- `uv run --all-packages python .planning/quick/260411-mbr-internal-notice-local-only-chunk-prep-pi/pilot_187233_local_chunk_prep.py`
- `uv run --all-packages python - <<'PY' ...` to assert quick-task artifact set, manual-review taxonomy coverage, and required official links for `260411-lxl`
- `uv run --package campus-ingestion-worker python -m campus_ingestion_worker.show_authenticated_notice_closeout --run-id local-postgres-wave-d-full-20260410-141615`
- `uv run --package campus-ingestion-worker python -m campus_ingestion_worker.promote_authenticated_notice_closeout --run-id local-postgres-wave-d-full-20260410-141615`
- `HTTP_PROXY='' HTTPS_PROXY='' ALL_PROXY='' NO_PROXY='*' http_proxy='' https_proxy='' all_proxy='' no_proxy='*' uv run --package campus-ingestion-worker python -m campus_ingestion_worker.release_registry_scope --corpus campus_notices --collection internal_notice --preparation-run-id prep-local-postgres-wave-d-full-20260410-141615 --no-publish-alias`
- `HTTP_PROXY='' HTTPS_PROXY='' ALL_PROXY='' NO_PROXY='*' http_proxy='' https_proxy='' all_proxy='' no_proxy='*' uv run --all-packages python - <<'PY' ...` to verify `internal_notice__r20260411_090101` exists in Qdrant, `internal_notice` alias remains unpublished, and release artifacts exist in derived object storage
- `curl --max-time 10 -sS -o /tmp/qdrant-proxy-check.json -w '%{http_code}\n' -H "api-key: $QDRANT_API_KEY" "$QDRANT_URL/collections"` (`timeout`, `000`) under inherited proxy env
- `env -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u http_proxy -u https_proxy -u all_proxy curl --max-time 10 -sS -o /tmp/qdrant-direct-check.json -w '%{http_code}\n' -H "api-key: $QDRANT_API_KEY" "$QDRANT_URL/collections"` (`200`) for direct no-proxy verification
- `env -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u http_proxy -u https_proxy -u all_proxy UV_CACHE_DIR=/tmp/uv-cache uv run --package campus-ingestion-worker python - <<'PY' ...` to read `campus_notices/releases/internal_notice/r20260411_090101/index-release.json` and `validation-summary.json`
- `uv run --all-packages python .planning/quick/260410-5yl-internal-notice-policy-regulation-cohort/cohort_a_local_quality_pilot.py --cohort-manifest .planning/quick/260410-5yl-internal-notice-policy-regulation-cohort/run14-policy-regulation-cohorts.json --local-smoke-root .tmp/historical-intake/run14-policy-regulation-expanded/local-smoke --output-dir .planning/quick/260410-5yl-internal-notice-policy-regulation-cohort`
- `uv run --all-packages python - <<'PY' ...` for `.planning/quick/260410-5yl-internal-notice-policy-regulation-cohort/cohort-a-validation-summary.json` and `.planning/quick/260410-5yl-internal-notice-policy-regulation-cohort/cohort-a-samples/samples.json`
- `env UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m unittest tests.evals.test_golden_cases tests.evals.test_context_diagnostics tests.specialist.test_rag_specialist tests.evals.test_curriculum_live_benchmark tests.evals.test_ragas_runtime`
- `set -a && source .env && set +a && env UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m campus_evals.curriculum_live_benchmark accept --reruns 3 --verbose --log-jsonl .tmp/evals/curriculum-runtime-events-20260410-wave-c.jsonl --output-dir .tmp/evals/curriculum-plan-live-gate-accept-20260410-wave-c` (`non-retryable supplemental preflight failure`, `provider_contract_violation`)
- `pnpm --dir apps/app-api test:node -- test/auth-and-db.test.ts test/chat-requests.route.test.ts test/telemetry.axiom.test.ts`
- `pnpm --dir apps/app-api test:worker -- --reporter=verbose test/worker.test.ts test/worker-runtime-cache.test.ts`
- `UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m unittest tests.retrieval.test_backend_qdrant tests.retrieval.test_service tests.specialist.test_rag_specialist`
- `UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m unittest tests.supervisor.test_supervisor_core tests.supervisor.test_supervisor_routing tests.supervisor.test_supervisor_policy tests.specialist.test_rag_specialist`
- `uv run --package campus-ingestion-worker python -m unittest tests.ingestion.test_authenticated_notice_import tests.ingestion.test_import_authenticated_notice_export_worker tests.ingestion.test_smoke_authenticated_notice_bootstrap_worker tests.ingestion.test_closeout_authenticated_notice_historical_backfill_worker tests.ingestion.test_authenticated_notice_closeout_async tests.ingestion.test_authenticated_notice_closeout_worker`
- `env UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m unittest tests.ingestion.test_chunking_policy.ChunkingPolicyTest.test_token_guardrail_expands_final_overlap_to_avoid_short_tail tests.ingestion.test_internal_notice_scope_chunk_pipeline tests.ingestion.test_authenticated_notice_closeout_async.AuthenticatedNoticeCloseoutServiceTest.test_source_truth_replay_workers_stage_parent_and_child_documents tests.ingestion.test_authenticated_notice_closeout_async.AuthenticatedNoticeCloseoutServiceTest.test_source_truth_replay_workers_record_no_text_ocr_outcome_without_child_document`
- `set -a && source .env && set +a && env UV_CACHE_DIR=/tmp/uv-cache uv run --package campus-ingestion-worker python -m campus_ingestion_worker.rebuild_authenticated_notice_source_truth_inventory --corpus campus_notices --collection internal_notice --notice-id 241275`
- `set -a && source .env && set +a && env UV_CACHE_DIR=/tmp/uv-cache uv run --package campus-ingestion-worker python -m campus_ingestion_worker.plan_authenticated_notice_source_truth_replay --run-id internal-notice-wave-d-241275-20260410-03 --corpus campus_notices --collection internal_notice --notice-id 241275 --shard-size 8 --batch-size 4 --max-concurrency 1 --notice-concurrency 2 --object-store-concurrency 8 --lease-seconds 300`
- `set -a && source .env && set +a && env UV_CACHE_DIR=/tmp/uv-cache uv run --package campus-ingestion-worker python -m campus_ingestion_worker.run_authenticated_notice_closeout_worker --run-id internal-notice-wave-d-241275-20260410-03 --worker-id pilot-worker-01`
- `set -a && source .env && set +a && env UV_CACHE_DIR=/tmp/uv-cache uv run --package campus-ingestion-worker python -m campus_ingestion_worker.validate_internal_notice_chunking --closeout-run-id internal-notice-wave-d-241275-20260410-03 --sample-dir .tmp/internal_notice_chunk_samples_wave_d_241275_probe_20260410`
- `pnpm --dir apps/public-chat-web test:worker`
- `pnpm --dir apps/public-chat-web typecheck`
- `pnpm --dir apps/public-chat-web build`
- `EVIDENCE_DIR=/home/reptilian/code/campus-agent/.tmp/staging-smoke/20260409T232000+0800-public-chat-wave6-closeout-2 node .tmp/public-chat-wave6/playwright-staging-smoke.mjs`

## Session Continuity

Last activity: 2026-04-13 - Completed Phase 1000 closeout: trace split landed across eval/app-api/operator surfaces, targeted `program_semester_facts` rematerialization was published, and fresh curriculum accept artifact passed all 3 runs

Last session: 2026-04-13T13:16:15+08:00
Stopped at: Phase 1000 is complete; next step is to either replace the historical curriculum artifact pointer or return to the remaining independent roadmap lanes
Resume file: None
