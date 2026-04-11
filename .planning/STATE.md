---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: in_progress
stopped_at: 2026-04-12 已完成 Phase 15-02：provider-agnostic grounding runtime、canonical claim-support schema 与 expanded claim taxonomy
last_updated: "2026-04-12T03:01:17+08:00"
progress:
  total_phases: 27
  completed_phases: 26
  total_plans: 73
  completed_plans: 71
---

# Project State

## State File Contract

- `PROJECT.md`
  - 项目级真相：范围、关键决策、validated/active/out-of-scope 与当前 truth
- `STATE.md`
  - 当前 worktree 的 `now / next / blockers / recent verification / continuity`
- `ROADMAP.md`
  - phase 顺序、插入记录与执行历史

## Project Reference

See: `.planning/PROJECT.md` (updated 2026-04-12)

**Core value:** 以已冻结的 supervisor-led multi-agent 架构和已落盘 serving/eval truth 为基础，完成验收收口、上线前硬化与真实产品面一致性，而不是继续把仓库当作地基期实验场
**Now:**
- 当前默认 active phase 已切到 Phase 15 `幻觉治理与 Grounded Generation 二次硬化`；`15-01`、`15-02` 已完成，`15-03` 到 `15-04` 仍待执行
- Phase 14 `Prompt Stack / System Prompt Runtime` closeout 已在当前 worktree 完成；staging closeout、`public-chat-web` strict donor parity 与 Wave E place-finding foundation 都已退出当前主动实现主线
- authenticated-notice Wave D 已完成 local Postgres current-scope refresh、preparation、promote 与 unpublished release；当前剩余是 post-release downstream consumption 和后置的 live portal / authenticated control-plane
**External blockers:**
- curriculum historical `warn` artifact replacement 仍被 supplemental eval provider `https://www.su8.codes/codex/v1` 的 `/responses` contract regression 阻断：provider 返回 `status='completed'` 但 `output=[]`
- `official_web/fresh_news` / `official_web/news_archive` runtime opening policy 仍在独立 worktree 处理

## Current Position

Phase: Acceptance-closeout and launch-hardening — IN PROGRESS
Plan: `docs/plans/post-closeout-follow-up-execution-plan.md` 已转为 deferred reference：Wave B/D/E 主体已关闭，Wave C 只剩 provider-blocked historical artifact replacement。当前默认 active implementation lane 是 `15-grounded-generation`；`.planning/phases/999.1-smoke-evidence-deferred-backlog/README.md` 目前仍无 active items
Next active workstream: Phase 15 `幻觉治理与 Grounded Generation 二次硬化` 当前已完成 `15-01`、`15-02`。Wave B 现已把 `ClaimSupport` / `claim_supports` 冻结为 canonical grounding truth，并让 `rag-specialist` 对 completed / downgrade 两条 prompt-answer 路径显式记录 per-claim support verdict 与 expanded taxonomy。下一执行入口是 `15-03`：扩展 eval、artifact retention 与 observability summary，让 adequacy / claim-support 成为 release-gate evidence。并行的外部 blocker 保持不变：replacing the historical curriculum `warn` artifact 仍取决于 supplemental eval LLM runtime 恢复 `/responses` accepted contract；authenticated-notice 后续只剩 deferred 的 live portal / authenticated control-plane 工作。

## Performance Metrics

**Velocity:**

- Total plans completed: 70
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

- Last completed plans: 13-01, 13-02, 13-03, 14-01, 14-02, 14-03
- Trend: 当前主线已从 `political-risk + fail-close baseline` 和 `prompt runtime closeout` 切换到 Phase 15 的 grounded-generation 二次硬化。下一步不再是追加 prompt 规则，而是把 retrieval adequacy、claim support、eval gating 与 operator observability 收口成 repo-default truth。

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
- Phase 10.1 inserted after Phase 10: Official Web Current Truth Closeout And Fresh News Surface Handoff (URGENT)
- Phase 10.2 added after Phase 10.1: Official Web Release Gate Dataset Quality Improvement
- Phase 10.3 added after Phase 10.2: Official Web Release Gate Chunk Cleanup And Header Normalization
- Phase 10.4 added after Phase 10.3: Official Web Corpus Split Routing And Stable Reference Bootstrap
- Phase 10.5 added after Phase 10.4: Official Web Stable Reference Release Evidence And Serving Surface Cleanup
- Phase 13 added after Phase 12.2: 政治风险判定与幻觉控制硬化
- Phase 14 added after Phase 13: 产品主链路 Prompt Stack 与 System Prompt Runtime 收口

### Decisions

Decision history now lives in `PROJECT.md` Key Decisions。
这里只保留当前执行面需要重复消费的 delta：

- 默认 active execution lane 已切到 Phase 15 `幻觉治理与 Grounded Generation 二次硬化`；当前 repo 不再把 `post-closeout` 文档当作默认实施入口
- `docs/plans/post-closeout-follow-up-execution-plan.md` 已转为 deferred reference：Wave A/B/D/E 主体完成，Wave C 只剩 provider-blocked historical artifact replacement
- Phase 14 `Prompt Stack / System Prompt Runtime` closeout 已在当前 worktree 落地；在合入 `develop` 前，它仍是 worktree-local progress
- staging baseline 已固定为 `campus-api-staging.ayafeed.com`、`campus-chat-staging.ayafeed.com`、`campus-panel-staging.ayafeed.com` 三个项目隔离一级子域；Wave B chat/panel/Sentry 证据保留为回归基线，而不是当前 open lane
- `official_web/fresh_news` / `official_web/news_archive` opening policy 继续留在独立 official-web worktree，不在当前执行面混入

### Pending Todos

- Execute Phase 15 waves `15-01` 到 `15-04`
- Freeze `official_web/fresh_news` / `official_web/news_archive` runtime opening policy in the official-web worktree
- Continue `internal_notice -> institutional_regulations` / `scoped_rules` downstream consumption，并在不提前开放 query surface 的前提下决定后续 release posture
- 扩充 `place_catalog` seed 覆盖面，并补真实 staging smoke / 人工验收证据
- 将 `.tmp/evals/curriculum-plan-live-gate-accept-20260404T200443Z` 继续视为当前 latest completed curriculum artifact，直到 supplemental provider 恢复 accepted `/responses` contract

### Blockers/Concerns

- 当前 follow-up 分支已无 repo-internal mainline blocker
- 外部 blocker 仍是 supplemental eval provider `https://www.su8.codes/codex/v1` 的 `/responses` contract regression：`status='completed'` 但 `output=[]`
- deferred blocker 仍是 authenticated-notice 的 live portal scheduling 与 authenticated control-plane，需要后续执行窗口和外部数据面配合
- panel 后续工作必须继续经由 `apps/app-api` owned surfaces，不能回退到 panel-side synthesis、audit log 直读或基础设施直读
- `Jobs` / `Operations` / `Audit` 继续不进入默认 rollout，除非产品范围重新开启

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
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

Last activity: 2026-04-12 - Completed Phase 15-02 grounding runtime hardening, added canonical claim-support diagnostics, and recorded Wave B verification evidence

Last session: 2026-04-12T03:01:17+08:00
Stopped at: Phase 15-02 is complete; next step is to execute `15-03` for eval, artifact retention, and observability expansion
Resume file: None
