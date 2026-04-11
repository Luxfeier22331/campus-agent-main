---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: in_progress
stopped_at: 2026-04-11 已修复 scoped_rules metadata-only refresh 漏洞并重跑 local-only acceptance；authenticated-notice 当前 repo-local 质量验收线已收口
last_updated: "2026-04-11T22:28:21+08:00"
progress:
  total_phases: 25
  completed_phases: 25
  total_plans: 66
  completed_plans: 66
---

# Project State

## Project Reference

See: `.planning/PROJECT.md` (updated 2026-04-11)

**Core value:** 以已冻结的 supervisor-led multi-agent 架构和已落盘 serving/eval truth 为基础，完成验收收口、上线前硬化与真实产品面一致性，而不是继续把仓库当作地基期实验场
**Current focus:** 当前 worktree 已进入 repo-level acceptance-closeout / launch-hardening 执行期。`official-web` / Phase 10 继续由其他 worktree 处理，这里不再反复提议；Wave A planning/worktree hygiene 已于 2026-04-06 完成，Wave B 与 `public-chat-web` Wave 6 也都已在 2026-04-09 收口。Wave C 的 repo-head remediation 已完成：`course_facts` supplemental truth 现已改到 internal doc ids，`rag-specialist` 现对课程 facts 使用 exact `target_document_ids` 并把课程/短事实回答收成 direct fact wording；对应 targeted verification 也已 fresh 通过。2026-04-10 又实际发起了一轮 fresh curriculum live rerun/accept，但 run 在 `supplemental-preflight` 即被当前 supplemental LLM provider `https://www.su8.codes/codex/v1` 的 Responses contract regression 阻断：provider 对 text / json-schema probe 都返回 `status='completed'` 但 `output=[]`。因此当前 deterministic truth 仍未回退：`student_handbook` pass artifact 仍是 `20260404T072912Z`，`curriculum_plan` latest completed full artifact 仍是 `.tmp/evals/curriculum-plan-live-gate-accept-20260404T200443Z`；它继续稳定在 deterministic `19/19` pass，而新的 artifact replacement 当前被 external supplemental provider regression 阻塞，而不是被 curriculum truth gap 阻塞。与此同时，authenticated-notice historical closeout 已通过 real run `authenticated-notice-replay-20260406-024405` 收口；local Postgres 上的 full current-scope refresh `local-postgres-wave-d-full-20260410-141615` 已先后完成 verified closeout、`prep-local-postgres-wave-d-full-20260410-141615` preparation validation、single promote `promotion-0001`，以及 unpublished release `r20260411_090101`。2026-04-11 当前 worktree 进一步完成了 Wave D 的 post-release consumption：`internal_notice` 现已具备 repo-owned `build_internal_notice_regulation_promotion_manifest -> materialize_internal_notice_regulation_candidates -> regulations/institutional_regulations` materialization 路径；同日又补齐了 `materialize_internal_notice_scoped_rules -> regulations/scoped_rules`，使 `annual_cycle_rule / time_bound_operational_rule` 可在不改写 source-side manifest 的前提下进入统一 holding collection，target posture 仍固定为 `offline_preparation`。同日当前 worktree 继续收口了 `scoped_rules` 的 local-only quality acceptance：在 isolated snapshot root 上，`10` 个 scoped-rule candidates 物化为 `9` 条 target documents，`305` 个 chunks 的 hard gate 全部通过，`short_body_chunk_count=29` 被显式记录为 soft observation，并新增“不要直接复用历史 local-smoke object-store 根目录作为 scoped-rules acceptance 输出根”的 operator rule。`institutional_regulations` 的 structure-aware short-fragment merge tuning 也已完成：Cohort A rerun 仍只导出 `187233` 一个 candidate，但它的 target-side chunk quality 已从 `needs_short_fragment_tuning_review` 收口为 `ready_for_target_materialization`，`short_body_chunk_count=0`。同日当前 worktree 还完成了 Wave E place-finding foundation：`campus_navigation/place_catalog` seed/runtime-profile、`navigation-specialist`、`place_lookup` routing、`app-api` `structured_parts_json` 持久化以及 `public-chat-web` 中文地点卡片均已落地，并通过 targeted Python/Vitest/TypeScript 验证。选课通知里的 `5` 个操作指引类 inline image 现在固定落到 `manual_review_required`，而不是 OCR lane；`internal_notice__r20260411_090101` 已写入 Qdrant Cloud（`213` points，`status=green`），但 alias `internal_notice` 仍未发布。同日当前 worktree 还完成了 Phase 13 `政治风险判定与幻觉控制硬化` 全部三步收口：supervisor policy/scope、rag grounding validator、cross-cutting release-gate case 与 app-api request observability fallback 现已同步关闭。

## Current Position

Phase: Acceptance-closeout and launch-hardening — IN PROGRESS
Plan: `docs/plans/post-closeout-follow-up-execution-plan.md` 的 Wave C-E 顺序仍成立，但当前 worktree 内已不再存在新的 repo-local executable wave：Wave C 继续被 external supplemental provider regression 阻塞，Wave D 已完成 local-postgres promote + unpublished release，Wave E code truth 也已关闭；`.planning/phases/999.1-smoke-evidence-deferred-backlog/README.md` 目前仍无 active items
Next active workstream: Phase 13 与 authenticated-notice `scoped_rules` local-only quality acceptance 都已完成 closeout；当前 worktree 内已不再存在新的 repo-local authenticated-notice executable slice。并行地，replacing the historical curriculum `warn` artifact 仍取决于 supplemental eval LLM runtime 恢复 `/responses` accepted contract；authenticated-notice 后续只剩 deferred 的 live portal / authenticated control-plane 工作，以及未来在产品授权后重新打开 `scoped_rules` query semantics。

## Performance Metrics

**Velocity:**

- Total plans completed: 60
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

- Last 5 plans: 10.4-01, 10.4-02, 10.5-01, 10.5-02
- Trend: `official_web` 当前已把 stable-reference 说明面与 fresh-news seed 面都推进到“有真实 physical collection + repo-tracked eval baseline + 本地实跑证据”的状态。下一步节奏应转向新闻面 runtime policy，而不是继续修补 split/import plumbing。

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
- Phase 10.1 inserted after Phase 10: Official Web Current Truth Closeout And Fresh News Surface Handoff (URGENT)
- Phase 10.2 added after Phase 10.1: Official Web Release Gate Dataset Quality Improvement
- Phase 10.3 added after Phase 10.2: Official Web Release Gate Chunk Cleanup And Header Normalization
- Phase 10.4 added after Phase 10.3: Official Web Corpus Split Routing And Stable Reference Bootstrap
- Phase 10.5 added after Phase 10.4: Official Web Stable Reference Release Evidence And Serving Surface Cleanup
- Phase 13 added after Phase 12.2: 政治风险判定与幻觉控制硬化

### Decisions

Decisions are logged in `PROJECT.md` Key Decisions table.
Recent decisions affecting current work:

- Query-serving is now runtime-profile-driven; current query-enabled scope is `student_handbook` plus `curriculum_plan`, while `campus_services` remains `offline_preparation`.
- Verification remains a dedicated release-gate phase after the main architecture path is in place.
- `official-web` / `availability` specialist landed as an explicit non-RAG specialist boundary instead of a supervisor-inline tool bundle.
- `/api/v1/answer` now constructs a supervisor-facing request contract instead of hardcoding a rag-specialist handoff.
- Phase 03.2 froze the data-plane direction as `raw -> source truth -> declared projections -> document/chunk/index`; later handbook-derived outputs must replay from persisted source truth instead of returning to raw.
- Phase 04 froze `rag-specialist` answer semantics on top of the accepted hybrid retrieval baseline with grounded citations plus `needs_clarification` / `no_answer` / `error` fail-close behavior.
- Phase 04.6 closed the Worker-to-origin seam: `apps/public-entry-worker -> apps/supervisor-api` with trusted-worker origin auth.
- Phase 04.7 is now completed on `main`; `apps/public-consumer-chat` implementation is a historical reference rather than the forward backend topology truth.
- Phase 05 removed bearer actor spoofing, projected caller claims from forwarded Access JWT payload, and moved durable audit persistence to the API shell boundary.
- The accepted forward design is now `public-chat-web` + `protected-panel-web` + shared `app-api`; auth/session/conversation, chat ingress, and operator query move into `app-api`, while `apps/supervisor-api` remains the execution engine.
- `apps/app-api` runtime is now frozen to Worker rather than remaining runtime-agnostic.
- `apps/app-api` is now the only product-layer auth/session/principal owner; `apps/supervisor-api` should be read as internal execution admission plus execution transport, not user-auth ownership.
- Protected panel request visibility is now fixed on shared `apps/app-api`: panel `Requests` must consume the shipped runtime-owned query surface and must not route around it through `apps/supervisor-api`, audit logs, telemetry sinks, or consumer chat tables.
- canonical request projection is now explicitly same-database outbox-first: `runtime.request_execution` plus `runtime.projection_outbox` are the first durable truth, while queues are optional later acceleration only.
- Better Auth is now fixed inside `apps/app-api`, and `auth/chat/runtime/operator` are expected to share one Drizzle schema codebase plus one migration pipeline; Worker runtime DB access remains Hyperdrive-based while migrations use a direct management connection.
- Protected panel operator access is now explicitly documented as a small-team operator surface without a self-serve end-user account system; `Jobs` and `Operations` remain delayed pending re-discussion.
- shared `apps/app-api` Worker foundation, request projection APIs, and current web-surface wiring are now implemented in merged truth; remaining work is follow-up hardening rather than topology bootstrap.
- `official_web` control plane is now implemented on `apps/app-api` with dedicated schema, collector command/query endpoints, outbox-driven operator projections, and scheduled ingestion handoff dispatch; `apps/protected-panel-web` now consumes the owned site/run/detail APIs instead of treating `Official Web` as a blocked next domain.
- Phase 05.1 froze curriculum source-truth quality gates, split-manifest review fail-close behavior, and explicit chunking runtime truth.
- Phase 06 added `provider_response_replay` rebuild support for `curriculum_plan`, and the current refactor promotes its serving policy into the profile-driven query surface.
- Phase 07 closed handbook release-gate verification with repo tests, live qrels benchmark, workflow/status samples, and handbook collection schema evidence under `.tmp/phase7/`.
- The detailed `app-api` implementation baseline now lives in `docs/plans/app-api-worker-foundation.md`, including framework selection, API surface, data domains, and execution waves.
- `app-api` 第一版产品层 HTTP contract、`app-api -> supervisor-api` execution contract、request lifecycle、error model 与 logical schema 现已冻结在 `docs/contracts/` 与 `docs/data/`。
- The accepted long-term split now separates verified identity, profile memory, session memory, and institutional knowledge into distinct truth layers.
- Personalization may influence intent framing, retrieval planning, clarification, and answer wording, but memory does not grant permissions or widen retrieval ACL.
- The current merged truth now treats `ContextProjection` + `SupervisorResponse` as the shared seam; follow-up work must preserve that seam instead of reintroducing `snapshot`.
- Curriculum gate closeout now has canonical docs/runbook coverage in `docs/reference/curriculum-plan-eval-metrics.md` and `docs/runbooks/curriculum-plan-hybrid-rebuild-checklist.md`; fresh live evidence belongs to the root worktree rather than this branch-local follow-up.
- shared `app-api -> supervisor-api` seam is now aligned to `ContextProjection` / `SupervisorResponse`: request payloads no longer depend on actor `snapshot`, `supervisor-api` accepts body `actor/context` after admission, and request projections keep `approval_required` / `rejected` as first-class runtime statuses.
- 2026-03-31 `210128` `student_handbook` acceptance rerun 已确认 live artifact truth：`deterministic_verdict=pass`、`supplemental_verdict=pass`、`final_overall_verdict=pass`，`repair` 跳过且无 applied targets，expanded `8`-case release gate 在真实 provider 上稳定通过。
- handbook post-phase quality line 现已正式关闭：`procedure` action-first answer contract、`procedure_directness`、`student-card / materials / time` 三个自然问句 signal、ID-based context metrics 与 prompt adaptation 都已经形成新的 live baseline，而不是仅停留在 repo-head 测试真相。
- 2026-04-02 `official_web` Phase 08-01 已确认 current worktree truth：`law.muc.edu.cn/szdw1.htm` 与相关 dense roster 页在 source-truth 层应归为 `directory_page`，当前 fresh repo evidence 以 `qc-20260402-batch-a-law-history-r5` 为准，而 `history.muc.edu.cn/` 继续保持 validated `listing_page`。
- 2026-04-02 `official_web` Phase 08-02 已冻结 repo workflow：stable regression gate、low-budget expansion batch、projection replay/import checklist 与 scheduler / hot-lane decision 现已显式分离，后续扩面不得再混淆 allowlisted、validated batch 和 scheduler promotion。
- 2026-04-02 `official_web` history listing projection follow-up 已在 `qc-20260402-history-r6` 关闭：首页 badge / duplicate rows 已去除，`rcpy.htm` 这类 listing 的压缩日期前缀已归一化，projection validator 继续保持 `valid=true`。
- 2026-04-02 `official_web/muc_public_pages` 当前 imported dataset 已完成 registry-backed Qdrant release 预演 `r20260402_152018` 与正式 alias publish `r20260402_152206`；当前 alias 指向 `muc_public_pages__r20260402_152206`，但 published release 仅包含 1 条 `official_web:muc_public:generic_content_page:*` 记录，chunk sampling 仍显示明显 listing-heavy newsroom noise，见 `docs/reference/official-web-muc-public-pages-release-20260402.md`。
- 2026-04-04 Phase 10 已完成：`official_web/muc_public_pages` runtime-profile 现在显式记录 `mixed` serving surface、`supports_freshness_sensitive_queries=false`、no live-search fallback；source truth / projection outputs 已携带 canonical publication/fetch metadata；freshness-sensitive official-web asks 已被 retrieval / specialist / eval truth 一起 fail-close。
- 2026-04-04 Phase 10.1 已完成：`official_web/muc_public_pages` 当前 truth 现已显式拆成 `11` 条 `release_gate_required`、`2` 条 `retain_inventory_only`、`8` 条 `future_fresh_news_surface`；repo 同时新增 machine-checkable partition/helper truth 与 `docs/reference/official-web-fresh-news-surface-handoff.md`，后续 fresh-news 工作不再需要重判这批 `inventory_only` 页面。
- 2026-04-04 Phase 10.2 已完成：`article_detail` source-truth projection 现在会在 fixed-scope `release_gate_required` 子集内按 section narrative paragraph 分批 flush，本地 replay `/tmp/official-web-qc-20260401-batch-d-clean-subset-projection-v7` 已验证 `学校概况 / 学校简介 = 3 units`、`本科培养 / 研究生培养 / 博士后 = 2 units`，且 chunk audit `0 issues`。
- 2026-04-04 Phase 10.3 已完成：support-only official-web line 现在会保留为显式 source-truth unit role，但不再进入 canonical markdown、chunk/index、retrieval ranking 或 answer row selection；final replay `/tmp/official-web-qc-20260401-batch-d-clean-subset-projection-v9` 已验证 `29/28/1` replay、`28 documents / 0 warnings` validator 与 `118 units / 138 chunks / 0 issues` chunk audit，同时 title-collapsed page header 与 grouped `notice_fact` 已不再出现 audit false positive。
- 2026-04-05 Phase 10.4 已完成：`official_web` corpus split 的第一条执行链路现在已是 repo 可执行 truth；stable-reference bootstrap 子集可从 replay 直接路由到 `official_web/stable_reference`，mixed replay output 也支持按请求 scope 单独导入。
- 2026-04-05 Phase 10.5 已完成：`official_web/stable_reference` 已完成首条真实 replay/import/release，physical collection 为 `official_web_stable_reference__r20260404_204033`；同时 retrieval / specialist / eval 辅助逻辑已支持 `stable_reference` 与 mixed bridge 共用 stable-reference-like 语义。
- 2026-04-05 stable-reference split-scope eval baseline 已完成：repo 现在补齐 `configs/ingestion/official_web/stable_reference/split-manifest.v1.json`、`packages/evals/fixtures/official_web_stable_reference_retrieval_qrels.json` 与 `official_web_stable_reference_release_gate_cases()`；修复 official-web 标题候选判断后，真实本地验证已确认 retrieval `9/9 hit@1`、`forbidden_hit_rate=0.0`，以及 deterministic live gate `11/11 pass`。
- 2026-04-05 `official_web_stable_reference` serving alias 已发布到 `official_web_stable_reference__r20260404_204033`，且 alias-path retrieval/live gate 继续通过；同时旧 `muc_public_pages` alias 已主动撤下，mixed bridge 不再冒充 serving surface。
- 2026-04-05 `official_web/fresh_news` 已完成首条 seed local release validation：repo 现在补齐 `configs/ingestion/official_web/fresh_news/split-manifest.v1.json`、`packages/evals/fixtures/official_web_fresh_news_retrieval_qrels.json` 与 `official_web_fresh_news_release_gate_cases()`；本地 physical collection `official_web_fresh_news__r20260404_222909` 已验证 retrieval `8/8 hit@1`、live gate `8/8 pass`。这轮 import/release 使用真实对象存储 + 真实 Qdrant，但因共享 Postgres pooler 饱和而改走 injected in-memory registry path，仅作为本地验证证据。
- 2026-04-10 authenticated-notice attachment legacy key cleanup 已完成 closeout：fresh pre-cleanup audit `.tmp/authenticated-notice-attachment-key-audit-20260410-153039/summary.json` 已确认 `referenced_legacy_key_count=0`、`unreferenced_legacy_key_count=2399`；repo 现已补齐 `campus_ingestion_worker.cleanup_authenticated_notice_source_attachment_keys` / `campus_ingestion_core.authenticated_notice_attachment_key_cleanup`，真实 cleanup evidence 落在 `.tmp/authenticated-notice-attachment-key-cleanup-20260410-154556/summary.json`，post-cleanup audit `.tmp/authenticated-notice-attachment-key-audit-20260410-154556-post-cleanup/summary.json` 已确认 `legacy_key_count=0`。
- 2026-04-10 source bucket hygiene cleanup 已完成：repo 现已补齐 `campus_ingestion_core.source_bucket_hygiene`、`campus_ingestion_worker.audit_source_bucket_hygiene` 与 `campus_ingestion_worker.cleanup_source_bucket_prefix`。fresh pre-cleanup audit `.tmp/source-bucket-hygiene-audit-20260410-161307-pre-cleanup/summary.json` 确认 `campus-rag-source` 仅剩 1 个 unexpected root prefix `debug`（`11` objects）；真实 cleanup evidence 落在 `.tmp/source-bucket-prefix-cleanup-20260410-161307-debug/summary.json`；post-cleanup audit `.tmp/source-bucket-hygiene-audit-20260410-161307-post-cleanup/summary.json` 已确认 `unexpected_root_prefix_count=0`、`unexpected_key_count=0`，当前根前缀只剩正式 source channel。
- 2026-04-11 Wave D post-release consumption 已在当前 worktree 收口：repo 新增 `campus_ingestion_core.internal_notice_regulation_materialization` 与 `campus_ingestion_worker.materialize_internal_notice_regulation_candidates`，可把 `internal_notice` manifest 中的 `promote_candidate` canonical text scope-refresh 到 `regulations/institutional_regulations`；target `document_id` 现在明确脱离 `notice_id`，duplicate notice provenance 会聚合到 target metadata，而 target posture 仍固定为 `offline_preparation`。
- 2026-04-11 `scoped_rules` target-side scope refresh 现已补齐 metadata-only artifact refresh truth：即使 semantic content hash / version id 不变，只要 `document-units` 内的 provenance metadata（例如 duplicate `source_notice_ids`）发生扩展，也必须重写 target artifacts，不能继续复用历史 local-smoke 留下的旧 bytes。
- 2026-04-11 Wave E place-finding foundation 已在当前 worktree 收口：repo 新增 `configs/ingestion/campus_navigation/place_catalog/{seed.v1.json,runtime-profile.json}`、`packages/navigation-specialist`、`packages/contracts` 的 `place_lookup` / `PlaceLookupResult` / `PlaceCard` contract、`packages/supervisor-core` 的 `navigation-specialist` 路由，以及 `apps/app-api` 的 `chat.messages.structured_parts_json` 与 `apps/public-chat-web` 的中文地点卡片渲染。当前 targeted verification 已通过 `uv run --all-packages python -m unittest tests.contracts.test_models tests.supervisor.test_supervisor_validation tests.supervisor.test_supervisor_routing tests.specialist.test_navigation_specialist tests.test_workspace_layout`、`pnpm --dir apps/app-api exec vitest run test/chat-command.service.test.ts test/chat-structured-parts.test.ts test/shared-product-bootstrap.contract.test.ts`、`pnpm --dir apps/public-chat-web exec vitest run test/platform-chat-mappers.test.ts test/platform-chat-message-parts.test.ts test/vendor-chat-message.test.ts`，以及两条 app-api/public-chat `tsc --noEmit`。
- 2026-04-11 Phase 13 planning 已正式落盘：`.planning/phases/13-policy-risk-and-hallucination-control-hardening/` 现已补齐 `13-CONTEXT.md`、`13-RESEARCH.md`、`13-01/02/03-PLAN.md`，并固定“政治风险处理 = policy/scope 分离，幻觉控制 = bounded evidence + post-LLM validation + eval gate”的 repo-local truth。
- 2026-04-11 `13-01` 已执行完成：supervisor 现在把校园政治课程问句、开放域政治事实问句、定向政治劝说请求分成三条不同路径；`political_persuasion` 作为具体 `policy_reason` 也已保留进 rejected observability。
- 2026-04-11 `13-02` 已执行完成：`rag-specialist` grounding validator 现已扩到 `offering_unit_claims` 与 `audience_claims`，prompt answer inventing 开课单位或适用专业时会 fail-close downgrade 为 `unsupported_by_evidence`。
- 2026-04-11 `13-03` 已执行完成：`packages/evals` 现已补齐 cross-cutting `policy_risk_and_grounding_release_gate_cases()` 与 `expected_handoff` trace grading，`apps/app-api` diagnostics-only request observability fallback 也已能稳定区分 supervisor `out_of_scope` stop 与 specialist `unsupported_by_evidence` downgrade。

### Pending Todos

- Freeze `official_web/fresh_news` / `official_web/news_archive` runtime opening policy now that the current seed baseline is locally validated; explicit decisions still need to cover freshness window, archive cutoff, fail-close, and live-search fallback.
- Treat `.tmp/staging-smoke/20260409T232000+0800-public-chat-wave6-closeout-2/` as the current `public-chat-web` strict donor parity baseline; future donor-visible drift, a reintroduced share/visibility affordance on launch path, or a regression of same-site authenticated `GET /api/history` / `GET /api/models` should reopen the gate.
- Keep handbook chunk-truth validation and handbook eval artifacts as reusable regression gates for later retrieval changes.
- Treat the 2026-04-04 `072912Z` handbook acceptance artifact as the current regression baseline for future handbook answer-path or eval-surface changes.
- Treat `.tmp/evals/curriculum-plan-live-gate-accept-20260404T200443Z` as the current latest completed repo-local curriculum artifact truth: deterministic reruns stabilize at `run_pass_counts=[19,19,19]` / `run_failed_counts=[0,0,0]`, repair stays skipped, and the remaining overall `warn` comes only from soft-gated supplemental quality drift.
- Keep `official_web` command/query/handoff tests and operator projections as reusable regression gates for later collector or ingestion integration changes.
- 将 system prompt 最终形态收口为 repo-default product-path prompt stack：repo-global developer invariants、package-owned role prompt、typed trusted/untrusted packets、strict structured output 与 metadata sink；后续实现不得回退成 monolithic mega prompt。
- Continue validating one already allowlisted `official_web` host at a time via low-budget expansion batch, and keep scheduler / hot-lane decisions separate from batch pass results.
- Keep `Jobs` and `Operations` out of the default panel rollout until product scope explicitly re-opens them.
- Treat historical authenticated-notice exports as the current Phase 12 execution substrate; bounded replay evidence (`2` / `10` / `50` / `240`) is now superseded first by the completed full closeout run `authenticated-notice-replay-20260406-024405`, then by the local Postgres full current-scope chain `local-postgres-wave-d-full-20260410-141615` -> `prep-local-postgres-wave-d-full-20260410-141615` -> `promotion-0001` -> unpublished release `r20260411_090101`, and now also by the repo-owned `internal_notice -> institutional_regulations` materialization path plus the donor-import fast-fail cleanup for attachment-backed local smoke. Cohort A target-side batch acceptance, structure-aware rerun, promotion adjudication fix, and non-regulation-rule boundary are all now repo-tracked truth: rebuilt inventory covers all `11` body-text notices, current promotion routing still exports only `187233`, and the remaining `10` notices are now explicitly frozen as `annual_cycle_rule` or `time_bound_operational_rule` that stay in `campus_notices/internal_notice` until a dedicated semantic-owner surface is explicitly reopened. The remaining follow-up is therefore no longer current-scope refresh, release approval, promotion materialization, donor local-smoke routing mismatch, target chunk tuning, or manual bucket naming guesswork, but still-deferred live portal / authenticated control-plane work and any later product-authorized reopen of dedicated downstream surfaces.
- The first real deployed Worker environment is now confirmed on first-level project-scoped `staging@ayafeed.com` hostnames: `campus-api-staging.ayafeed.com`, `campus-chat-staging.ayafeed.com`, and `campus-panel-staging.ayafeed.com`. This replaces both the earlier nested `*.rag.ayafeed.com` staging truth and the later generic first-level proposal because the current Cloudflare tier is no longer treated as having reliable SSL coverage on nested staging subdomains, and `ayafeed.com` is a shared zone where generic first-level labels such as `api-staging.ayafeed.com` are already owned by other repos.
- Wave B chat closure is no longer pending: `campus-api-staging` `/healthz` + `/readyz` and `campus-chat-staging` `/healthz` + `/readyz` now return `200`, while `campus-chat-staging` request `req_3f493161ae6c4c669304c4ca439dfe4a` finalized as `answer` with `trace_id=trace_f3d3792b021f4118ac90a06041f9b03f`; closure evidence now lives under `.tmp/staging-smoke/20260406T032941-wave-b-closure/` and `.tmp/observability-smoke/20260406T032941-staging-wave-b/`.
- Wave B panel closure is no longer pending: `.tmp/staging-smoke/20260406T115658-panel-requests-fix/SUMMARY.md` confirms `help_bot@outlook.com` completed real Cloudflare Access login, `GET /api/overview` / `GET /api/requests?limit=20` / `GET /api/requests/:id` / `GET /api/requests/:id/observability` all returned `200`, and the prior `401 -> /cdn-cgi/access/logout` loop is no longer reproducible.
- Wave B Sentry closure is no longer pending: `.tmp/observability-smoke/20260409T204915-staging-wave-b-sentry-closure/` confirms repo-local `SENTRY_API_TOKEN` can query Sentry Explore `spans` for real staging traces, including `trace=aa87e040f4a74358aa74b62fa06b87b8` across `campus-agent-chat -> campus-agent-api` and `trace=cd55de711b3244eba5b2ca5f7c496ebe` across `campus-agent-panel -> campus-agent-api`. Direct `issues` listing may still return `403`, but that is no longer a closure blocker because Wave B now uses trace-linked span rows as the canonical event-level evidence.
- Treat Wave E place-finding targeted tests and typechecks as the current regression gate: `tests.specialist.test_navigation_specialist` + `tests.supervisor.test_supervisor_*`, `apps/app-api` 的 chat structured-parts tests, `apps/public-chat-web` 的 message-part / vendor message tests，以及两条 `tsc --noEmit`。下一条导航工作不再是 foundation 设计，而是 seed 扩面、真实 staging smoke / 人工验收；`route_graph` / `route_planning` 继续明确后置。

### Blockers/Concerns

- The current worktree no longer has a phase-evidence blocker: `.planning/v1.0-MILESTONE-AUDIT.md` is now closed as `tech_debt`, and the remaining archive-scaffold absence is a process issue rather than a runtime or planning-truth blocker.
- No current phase-1 mainline blocker remains inside this follow-up branch.
- Cloudflare 04.x boundary/topology/contract/shell docs are complete; follow-up work must consume them as frozen handoffs rather than reopening architecture churn.
- `public-consumer-chat` is merged on `main`; downstream work should treat it as a historical implementation reference rather than a live backend direction.
- panel `Requests` is no longer blocked, but panel work must still avoid reading audit logs, telemetry sinks, consumer chat tables, or `apps/supervisor-api` directly.
- `Official Web` control-plane APIs and panel domain are now landed on `apps/app-api` + `apps/protected-panel-web`; follow-up work must extend this surface rather than reintroducing panel-side synthesis or direct infrastructure reads.
- `Jobs` / `Operations` / `Audit` remain delayed; landed `Official Web` views do not authorize a generic ops console.
- Observability runtime code is landed, local worktree env is ready, and the targeted Worker smokes are green. The latest local evidence still lives at `.tmp/observability-smoke/20260402T233916-local-readiness/`, the prior staging chat/Axiom checkpoint lives at `.tmp/observability-smoke/20260406T032941-staging-wave-b/`, the panel closure evidence lives at `.tmp/staging-smoke/20260406T115658-panel-requests-fix/`, and the final Sentry closure artifact now lives at `.tmp/observability-smoke/20260409T204915-staging-wave-b-sentry-closure/`. There is no remaining Wave B blocker in this worktree; future work should only reopen this lane if deploy truth or sink behavior regresses.
- `apps/app-api` Wave B closeout now includes two staging-specific hardening moves: `[env.staging.vars] SUPERVISOR_API_TIMEOUT_MS=\"15000\"` to absorb the current supervisor latency budget, and Sentry telemetry fail-open so `configureChatRequestScope` / `getTraceData` failures can no longer become request-path `500`.
- `student_handbook` 当前最新 release-truth artifact 已更新为 `.tmp/evals/student-handbook-formal-benchmark-accept-20260404T072912Z`；较早的 `20260402T182346`、`181247` 与 `210128` 仍可作为历史健康 baseline 对照，但不再是最新 closeout 证据。
- `student_handbook` 的 repo-local 2026-04-04 rerun 现在已经有新的 clean pass baseline：`.tmp/evals/student-handbook-formal-benchmark-accept-20260404T072912Z` 的 `deterministic_verdict=pass`、`supplemental_verdict=pass`、`final_overall_verdict=pass`，三轮 deterministic run 稳定复现 `run_pass_counts=[11,11,11]` / `run_failed_counts=[0,0,0]`。
- Phase 8 的本地 automated gates 与 fresh handbook live accept 现已全部通过，Phase 09.1 也已补齐 env/bootstrap/provider contract；因此 handbook Phase 8 closeout 现可视为 completed truth。
- 2026-04-03 的 repo-local curriculum / handbook fail artifacts 仍然只应作为历史故障排查参考，不再代表当前状态：本地 `trusted-worker + 8081`、preview rebuild、publish alias、current-row canonicalization，以及 handbook rerun `internal_error` 都已经被后续恢复工作覆盖。
- `curriculum_plan` 的 repo-local 最新 completed accept artifact 现已更新为 `.tmp/evals/curriculum-plan-live-gate-accept-20260404T200443Z`：`deterministic_verdict=pass`、`supplemental_verdict=warn`、`final_overall_verdict=warn`，repair skipped，三轮 deterministic run 全部 `19/19` 通过。当前不再有 deterministic curriculum release gate failure；remaining issue is soft-gated supplemental quality only. Earlier rerun attempt `.tmp/evals/curriculum-plan-live-gate-accept-20260404T130027Z` 仍只应被视为 mid-request restart incident，而不是新的产品质量结论。
- `apps/authenticated-notice-collector` 现在已经补齐 `pyproject.toml`，因此 authenticated-notice 相关 focused verification 可以正常使用 `uv run --package ...`；后续 Phase 12 不应再按“collector 缺 package metadata”这个旧 blocker 规划。
- `official_web` 当前已无 phase blocker；`history` listing projection 的重复 / 日期噪声已在 `qc-20260402-history-r6` 关闭。剩余 concern 只在节奏层：任何 scheduler / hot-lane promotion 仍需单独证据，而不是沿用现有 batch 结果直接外推。
- `official_web/muc_public_pages` 的 release plumbing、candidate import 与 serving-surface correctness policy 现已闭环：replay v9 已生成 unpublished candidate `r20260404_184508`，并通过 qrels/live gate。当前 remaining concern 已不再是 mixed alias 漂移，因为旧 alias 已撤下；剩余问题转到 news-serving policy 本身。
- 当前 fixed-scope clean/chunking blocker 已关闭：replay v9 的 `source_only` / `terminal_boilerplate` / header drift 与 notice-fact audit false positive 都已 machine-checkably 收口。剩余 concern 只在是否把这轮本地 truth 滚入新的 import/release candidate，而不是继续怀疑当前 clean/chunking contract。
- Phase 10.1 已把 current-vs-future boundary 写成 helper + docs 双重 truth；后续如果再讨论 `future_fresh_news_surface`，应直接以 handoff note 和 helper 为起点，而不是回到 inventory triage 重新争论。
- 共享 Postgres pooler 在本轮 fresh-news CLI import 时触发 `MaxClientsInSessionMode`；这不是语料或 runtime 设计 blocker，但说明后续若要把 fresh-news 正式写入 shared registry truth，仍需先恢复可用的 registry 连接额度或切换到合适的 shared DB 通道。
- staging `app-api` auth/runtime instability is now closed in this worktree: request-scoped auth and command-side runtime can read through dedicated `APP_API_DB_FRESH` no-cache Hyperdrive while read-mostly query surfaces stay on `APP_API_DB`; live evidence ` .tmp/staging-smoke/20260404t141510z-app-api-auth-fresh-hyperdrive-live ` confirms `readyz 10/10`, `chat-readyz 10/10`, and `sign-up -> immediate sign-in -> get-session` all `5/5 200`.
- Phase 12.1 freezes two closeout-specific execution rules: authenticated-notice staged checkpoints may only use cumulative full-bundle prefixes because import uses `scope_refresh=(corpus, collection)`, and raw asset registry reconciliation only requires expected ID coverage because raw scope history is retained outside document-scope refresh.
- Phase 9 与 handbook live accept 是两条独立工作流：它复用已落地的 handbook ambiguous-object posture，但本身不依赖新的 handbook acceptance artifact 才能开始规划或执行；当前 09-03 closeout 已把 deictic verified-identity truth、soft-bias-only qrels fast-fail 与 diagnostics 收口为 completed truth。
- curriculum canonical eval truth 现已明确禁止把未裁决短标题歧义锁成单目标 qrels；`民族实验班` 已退出 canonical retrieval qrels，改由 `needs_clarification` workflow case 承担，`campus_evals.retrieval_benchmark` 会在评分前按 split manifest fast-fail 这类坏 truth。
- Phase 9 现在额外固定了两条关键后置约束：`verified major + unique candidate` 才允许 deictic curriculum single-doc resolve，而 `recent_goal` / `confirmed_slot_terms` / profile memory 只能作为 soft bias 或 clarification input；external default query scope 仍旧只开放 `curriculum_plan`。
- Phase 11 is now fully closed: the principal/projection seam, data-plane canonicalization, retrieval fail-close / deny-path leakage prevention, safe personalization wiring, and compatibility / eval / telemetry closure are all landed.

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
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

Last activity: 2026-04-11 - Completed institutional_regulations structure-aware short-fragment merge tuning: Cohort A rerun keeps `candidate_count=1`, but `187233` now closes target chunk prep at `short_body_chunk_count=0` and `quality_posture=ready_for_target_materialization`

Last session: 2026-04-11T08:12:00+08:00
Stopped at: Authenticated-notice remaining repo-local work is now narrowed to promotion admission/routing review for 10 manual-review notices, plus still-deferred live portal and authenticated control-plane work
Resume file: None
