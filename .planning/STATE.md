---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: in_progress
stopped_at: 2026-04-05 completed official-web stable-reference alias publish, fresh-news seed local release validation, and merged latest develop planning/runtime truth
last_updated: "2026-04-05T11:30:00+08:00"
progress:
  total_phases: 25
  completed_phases: 25
  total_plans: 62
  completed_plans: 62
---

# Project State

## Project Reference

See: `.planning/PROJECT.md` (updated 2026-04-05)

**Core value:** 先把新的 supervisor-led multi-agent 架构站稳，并用 runtime-profile-driven serving surface 证明这条架构能可靠承接高频校园问答
**Current focus:** `official_web/stable_reference` 已经完成 serving alias publish，`official_web/fresh_news` 也完成了首条 seed local release + retrieval/live gate 验证。接下来的 active workstream 不再是“要不要发 alias”，而是收口 `fresh_news/news_archive` 的 runtime opening policy；与此同时，merged develop truth 已把 `student_handbook` 最新 pass artifact 收口到 `20260404T072912Z`，并把 `curriculum_plan` 最新 completed full artifact 收口到 `20260404T200443Z`。

## Current Position

Phase: 10.5 (Official Web Stable Reference Release Evidence And Serving Surface Cleanup) — COMPLETED
Plan: 2 of 2
Next active workstream: freeze `official_web/fresh_news` / `official_web/news_archive` runtime opening criteria after the current seed baseline, while keeping both scopes query-closed until freshness/archive policy is explicit

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

### Pending Todos

- Freeze `official_web/fresh_news` / `official_web/news_archive` runtime opening policy now that the current seed baseline is locally validated; explicit decisions still need to cover freshness window, archive cutoff, fail-close, and live-search fallback.
- Keep handbook chunk-truth validation and handbook eval artifacts as reusable regression gates for later retrieval changes.
- Treat the 2026-04-04 `072912Z` handbook acceptance artifact as the current regression baseline for future handbook answer-path or eval-surface changes.
- Treat `.tmp/evals/curriculum-plan-live-gate-accept-20260404T200443Z` as the current latest completed repo-local curriculum artifact truth: deterministic reruns stabilize at `run_pass_counts=[19,19,19]` / `run_failed_counts=[0,0,0]`, repair stays skipped, and the remaining overall `warn` comes only from soft-gated supplemental quality drift.
- Keep `official_web` command/query/handoff tests and operator projections as reusable regression gates for later collector or ingestion integration changes.
- Continue validating one already allowlisted `official_web` host at a time via low-budget expansion batch, and keep scheduler / hot-lane decisions separate from batch pass results.
- Keep `Jobs` and `Operations` out of the default panel rollout until product scope explicitly re-opens them.
- Treat historical authenticated-notice exports as the current Phase 12 execution substrate; the current worktree now has bounded replay evidence for `2`, `10`, `50`, and `240` notice slices, while `6694` backfill and renewed live portal access remain deferred follow-on work.
- The first planned deployed Worker environment now converges on first-level `staging@ayafeed.com` hostnames: `api-staging.ayafeed.com`, `chat-staging.ayafeed.com`, and `panel-staging.ayafeed.com`. This replaces the earlier nested `*.rag.ayafeed.com` staging truth because the current Cloudflare tier is no longer treated as having reliable SSL coverage there; repo docs are updated, but repo config/tests still carry legacy nested hostname migration debt and remote Cloudflare resources, secret store values, and post-deploy smoke evidence still do not exist in this worktree’s accepted truth.
- For the first real deployed Worker environment, confirm deploy-side `SENTRY_*` / `AXIOM_*` assignment for `apps/app-api`, `apps/public-chat-web`, and `apps/protected-panel-web`, then run post-deploy smoke verification for trace propagation, error capture, and minimal runtime event ingest. Local preflight and targeted Worker smoke were revalidated on 2026-03-31, so this is now a deployment gate rather than an active local-engineering blocker.
- Pending todo: [`.planning/todos/pending/2026-04-04-redeploy-chat-staging-after-auth-runtime-fix.md`] should only execute after staging resources are actually provisioned and `app-api-staging` exists as a real remote surface.
- Pending todo: [`.planning/todos/pending/2026-04-04-provision-real-access-for-panel-staging.md`] remains the future Cloudflare Access step once `panel-staging.ayafeed.com` is externally provisioned.
- Pending todo: [`.planning/todos/pending/2026-04-04-run-full-staging-live-smoke-and-observability.md`] captures the final full-lane live smoke, evidence, and observability closure after `app-api` and `panel` blockers are removed.

### Blockers/Concerns

- The current worktree no longer has a phase-evidence blocker: `.planning/v1.0-MILESTONE-AUDIT.md` is now closed as `tech_debt`, and the remaining archive-scaffold absence is a process issue rather than a runtime or planning-truth blocker.
- No current phase-1 mainline blocker remains inside this follow-up branch.
- Cloudflare 04.x boundary/topology/contract/shell docs are complete; follow-up work must consume them as frozen handoffs rather than reopening architecture churn.
- `public-consumer-chat` is merged on `main`; downstream work should treat it as a historical implementation reference rather than a live backend direction.
- panel `Requests` is no longer blocked, but panel work must still avoid reading audit logs, telemetry sinks, consumer chat tables, or `apps/supervisor-api` directly.
- `Official Web` control-plane APIs and panel domain are now landed on `apps/app-api` + `apps/protected-panel-web`; follow-up work must extend this surface rather than reintroducing panel-side synthesis or direct infrastructure reads.
- `Jobs` / `Operations` / `Audit` remain delayed; landed `Official Web` views do not authorize a generic ops console.
- Observability runtime code is landed, local worktree env is ready, and the targeted Worker smokes are green. The latest local evidence now lives at `.tmp/observability-smoke/20260402T233916-local-readiness/`. There is no current local-engineering blocker here; the repo truth is that staging remains a repo-owned deploy target definition rather than an already-provisioned remote environment. When staging deployment exists, the smoke runner should use `chat-staging.ayafeed.com`, `panel-staging.ayafeed.com`, `api-staging.ayafeed.com`, the current Worker release identifier, and Sentry/Axiom access; nested `*.rag.ayafeed.com` URLs are now legacy migration debt only, while local placeholder URLs such as `chat.example.com`, `panel.example.com`, and `app-api.internal` remain development-only values.
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

## Recent Verification

- `pnpm --dir apps/app-api test:node -- test/auth-and-db.test.ts test/chat-requests.route.test.ts test/telemetry.axiom.test.ts`
- `pnpm --dir apps/app-api test:worker -- --reporter=verbose test/worker.test.ts test/worker-runtime-cache.test.ts`
- `UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m unittest tests.retrieval.test_backend_qdrant tests.retrieval.test_service tests.specialist.test_rag_specialist`
- `UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m unittest tests.supervisor.test_supervisor_core tests.supervisor.test_supervisor_routing tests.supervisor.test_supervisor_policy tests.specialist.test_rag_specialist`
- `uv run --package campus-ingestion-worker python -m unittest tests.ingestion.test_authenticated_notice_import tests.ingestion.test_import_authenticated_notice_export_worker tests.ingestion.test_smoke_authenticated_notice_bootstrap_worker tests.ingestion.test_closeout_authenticated_notice_historical_backfill_worker tests.ingestion.test_authenticated_notice_closeout_async tests.ingestion.test_authenticated_notice_closeout_worker`

## Session Continuity

Last session: 2026-04-05T06:55:00+08:00
Stopped at: `official_web_stable_reference` alias publish, `muc_public_pages` alias unpublish, and `official_web/fresh_news` seed local release validation are complete; next step is news-serving runtime policy
Resume file: None
