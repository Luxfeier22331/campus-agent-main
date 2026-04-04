---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: in_progress
stopped_at: 2026-04-05 repo-local full curriculum live accept rerun has completed at `.tmp/evals/curriculum-plan-live-gate-accept-20260404T200443Z`: the semester course-list answer repair is now live-verified, all three deterministic runs pass `19/19`, repair stays skipped, and the only remaining gate issue is supplemental soft-warn quality drift
last_updated: "2026-04-05T11:30:00+08:00"
progress:
  total_phases: 22
  completed_phases: 21
  total_plans: 58
  completed_plans: 55
---

# Project State

## Project Reference

See: `.planning/PROJECT.md` (updated 2026-04-05)

**Core value:** 先把新的 supervisor-led multi-agent 架构站稳，并用 runtime-profile-driven serving surface 证明这条架构能可靠承接高频校园问答
**Current focus:** Phase 11 与 Phase 9 现已全部完成：Phase 11 已收口 canonical principal/projection seam、restricted data-plane projection、retrieval fail-close / deny-path safety、safe personalization wiring，以及 compatibility / eval / telemetry closure；Phase 9 则补齐了 curriculum alias governance、deictic verified-identity truth、soft-personalization fast-fail 与 eval closeout。`official-web` / Phase 10 当前由其他 worktree 处理，不应在这里被反复重新提议；这个 worktree 当前的非 web 主线已经把 repo-local eval truth 收口到新的稳定基线：`student_handbook` 当前 pass artifact 为 `20260404T072912Z`，`curriculum_plan` 当前 latest completed full artifact 为 `20260404T200443Z`。其 live accept 现已达到 deterministic `19/19` pass，law follow-up completeness 缺口已经在 live artifact 中关闭；当前剩余的只是 supplemental soft-warn，而不是 deterministic release gate failure。deploy 侧目前只有 repo-owned staging config / runbook / secret inventory 准备完成，远端 Cloudflare 资源、secret store 与真实 smoke 仍未外部 provision，因此这里不再把任何“staging live 故障”当作当前事实。

## Current Position

Phase: 09 (Curriculum Ambiguous Program Query Hardening) — COMPLETED
Plan: 3 of 3 completed (`09-01` ~ `09-03` verified)
Next active workstream: treat curriculum deterministic release gate as live-closed and decide whether to spend another cycle on supplemental quality lift. The latest completed no-restart rerun is now `.tmp/evals/curriculum-plan-live-gate-accept-20260404T200443Z`; all three deterministic runs pass, repair remains skipped, and the remaining overall `warn` comes only from soft-gated `ragas.*` averages below threshold. Attempt `.tmp/evals/curriculum-plan-live-gate-accept-20260404T130027Z` still remains only a stale mid-request restart incident record. Parallel deploy prep remains narrower: keep staging limited to repo-owned config/runbook readiness until external Cloudflare provisioning and secret injection actually exist. `official-web` / Phase 10 stays in a separate worktree

## Performance Metrics

**Velocity:**

- Total plans completed: 50
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

**Recent Trend:**

- Last 5 plans: 11-01, 11-02, 11-03, 11-04, 11-05
- Trend: Phase 11 与 Phase 9 已完成 closeout；repo-local canonical rebuild / alias publish / `app-api` runtime stability fix 已完成，handbook current pass baseline 现已更新为 `20260404T072912Z`，当前这个 worktree 的主线风险只剩 curriculum stale qrel / ranking gap closeout，`official-web` / Phase 10 继续由其他 worktree 承接

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
- Phase 8 added: Student Handbook Ambiguous Policy Query Hardening
- Phase 8 closeout 已完成；fresh handbook live accept 已在 repo bootstrap path 下重新通过，并形成最新 release-truth artifact
- Phase 9 added: Curriculum Ambiguous Program Query Hardening
- Phase 9 implementation now includes internal `course_facts` serving surface, canonical course/course-family specialist planning, program-family direct-answer/clarification truth, deictic verified-major resolution, forbidden generic alias fail-close, richer curriculum diagnostics, and eval/qrels fast-fail coverage for family alias collapse plus soft-personalization-only single-doc truth
- Phase 09.1 inserted after Phase 9: Env Bootstrap And Provider Configuration Governance (URGENT)
- Phase 09.1 implementation now includes explicit bootstrap state, shared provider precedence resolution, eval-side surface-aware provider errors, and a non-secret-leaking `doctor_env` command
- Phase 11 added: Campus Identity, Authorization, Memory, And Restricted Document Foundation
- Phase 12 added: Authenticated Notice Source Foundation
- Phase 12.1 inserted after Phase 12: Authenticated Notice Historical Backfill Closeout
- Phase 12.2 inserted after Phase 12.1: Authenticated Notice Async Staged Closeout, immediately kicking off async shard modeling, operations prefix planning under `campus_notices/operations/authenticated-notice-closeout/{run_id}`, staging tables, single-promoter commit semantics, and deterministic verification.
- Phase 12.2 `12.2-01` is now closed: architecture language, ADR, and runbook entries describe the operations prefix directory layout, staging tables, async shard executor expectations, single promoter commit, and verification plan, so only implementation remains for 12.2-02.
- Phase 12.2 `12.2-02` is now closed in the current worktree: `packages/ingestion-core` now owns the authenticated notice closeout planner/store/service/verifier, `apps/ingestion-worker` now exposes `run/show/promote` CLI for async staged closeout, operations artifacts are written under `campus_notices/operations/authenticated-notice-closeout/{run_id}/`, and promotion is now a single `replace_scope` commit after deterministic staged verification.
- Phase 12 `12-02` is now closed: staged historical replay no longer stalls on repo-local MinIO because `S3ObjectStoreWriter` isolates zero-byte object writes to a one-shot client, and bounded replay evidence now exists for `2`, `10`, and `50` notice slices under `.tmp/authenticated-notice-smoke/20260404T131900-2-timed`, `.tmp/authenticated-notice-smoke/20260404T131350-10`, and `.tmp/authenticated-notice-smoke/20260404T131544-50`
- Phase 12 `12-03` is now closed: `apps/authenticated-notice-collector` exports typed reference-only `links / notice_attachments / attachments`, validates notice-type governance, and persists the policy snapshot into the export manifest without giving the collector registry/chunk/index ownership.
- Phase 12 `12-04` is now closed in the current worktree: bounded historical replay evidence now reaches `.tmp/authenticated-notice-smoke/20260404T152745-240/summary.json`, while large `6694` backfills, live portal scheduling, and authenticated control-plane work remain explicitly deferred.
- Phase 12.1 `12.1-01` is now closed in the current worktree: the repo now owns a historical closeout runner plus runbook/docs, staged replay is explicitly frozen to cumulative prefix slices, and raw asset reconciliation is coverage-only while document scope reconciliation remains exact.

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
- Phase 05 removed bearer actor spoofing, requires canonical `ContextProjection` on the trusted-worker path, and keeps durable audit persistence at the API shell boundary.
- The accepted forward design is now `public-chat-web` + `protected-panel-web` + shared `app-api`; auth/session/conversation, chat ingress, and operator query move into `app-api`, while `apps/supervisor-api` remains the execution engine.
- `apps/app-api` runtime is now frozen to Worker rather than remaining runtime-agnostic.
- `apps/app-api` is now the only product-layer auth/session/principal owner; `apps/supervisor-api` should be read as internal execution admission plus execution transport, not user-auth ownership.
- Navigation-related first rollout sequencing is now fixed as `place_lookup` / `place_finding` first, with route planning, entrance selection, accessibility routing, and route interaction explicitly deferred to a later phase.
- Protected panel request visibility is now fixed on shared `apps/app-api`: panel `Requests` must consume the shipped runtime-owned query surface and must not route around it through `apps/supervisor-api`, audit logs, telemetry sinks, or consumer chat tables.
- canonical request projection is now explicitly same-database outbox-first: `runtime.request_execution` plus `runtime.projection_outbox` are the first durable truth, while queues are optional later acceleration only.
- Better Auth is now fixed inside `apps/app-api`, and `auth/chat/runtime/operator` are expected to share one Drizzle schema codebase plus one migration pipeline; Worker runtime DB access remains Hyperdrive-based while migrations use a direct management connection.
- Protected panel operator access is now explicitly documented as a small-team operator surface without a self-serve end-user account system; `Jobs` and `Operations` remain delayed pending re-discussion.
- shared `apps/app-api` Worker foundation, request projection APIs, and current web-surface wiring are now implemented in merged truth; remaining work is follow-up hardening rather than topology bootstrap.
- `official_web` control plane is now implemented on `apps/app-api` with dedicated schema, collector command/query endpoints, outbox-driven operator projections, and scheduled ingestion handoff dispatch; `apps/protected-panel-web` now consumes the owned site/run/detail APIs instead of treating `Official Web` as a blocked next domain.
- Phase 05.1 froze curriculum source-truth quality gates, split-manifest review fail-close behavior, and explicit chunking runtime truth.
- Phase 06 added `provider_response_replay` rebuild support for `curriculum_plan`, and the current refactor promotes its serving policy into the profile-driven query surface.
- Public curriculum docs no longer project `visibility_scope=main`; `main` is not an access-control boundary, and public split-manifest docs now resolve to `visibility_scope=null` even when collection defaults exist.
- Phase 07 closed handbook release-gate verification with repo tests, live qrels benchmark, workflow/status samples, and handbook collection schema evidence under `.tmp/phase7/`.
- The local canonical-registry recovery stream now has completed preview/publish truth: `.tmp/rebuilds/local-live-eval-recovery-20260404T010216`, `.tmp/rebuilds/local-live-eval-recovery-publish-handbook-20260404T011422`, and `.tmp/rebuilds/local-live-eval-recovery-publish-curriculum-20260404T012037` restored handbook/curriculum current rows to canonical-only truth without reintroducing legacy ACL carrier compatibility into runtime query code.
- The current worktree also lands repo-local `app-api` runtime stability fixes for rerun closure: development no longer reuses cached worker/db/auth state, readiness probes use isolated short-lived DB pools instead of request-path pools, synthetic `/api/internal/evals/chat/requests` ingress no longer schedules request projection drain, and Axiom ingest is bounded fail-open; under these changes, repeated local internal-eval requests no longer reproduce the earlier `wrangler dev` collapse.
- The detailed `app-api` implementation baseline now lives in `docs/architecture/product-runtime-architecture.md`, including framework selection, API surface, data domains, and execution waves.
- `app-api` 第一版产品层 HTTP contract、`app-api -> supervisor-api` execution contract、request lifecycle、error model 与 logical schema 现已冻结在 `docs/contracts/` 与 `docs/data/`。
- The accepted long-term split now separates verified identity, profile memory, session memory, and institutional knowledge into distinct truth layers.
- Personalization may influence intent framing, retrieval planning, clarification, and answer wording, but memory does not grant permissions or widen retrieval ACL.
- The current merged truth now treats `ContextProjection` + `SupervisorResponse` as the shared seam; follow-up work must preserve that seam instead of reintroducing `snapshot`.
- Phase 11 `11-01` now makes canonical `principal_type` and authorization `projection_source` explicit on the shared `ContextProjection` seam, so public, campus, and operator paths are distinguishable without raw auth payloads.
- Phase 11 `11-02` now treats `visibility_* + entitlement_*` as the primary restricted-document data-plane projection, with legacy `acl_level / acl_groups / campus_scope` retained only as canonical-derived compatibility mirrors.
- Phase 11 `11-03` now enforces canonical-only restricted retrieval pre-filtering, fail-closes targeted restricted doc access before candidate retrieval, and keeps deny paths free of resolved titles and evidence leakage by default.
- Phase 11 `11-04` now treats supervisor/specialist personalization as an explicit safe-consumption seam: supervisor only uses typed memory for clarification wording, `rag-specialist` only consumes `user_visible` profile memory plus confirmed session slots, and `internal_only` memory no longer enters personalization framing.
- Phase 11 `11-05` now removes top-level retrieval ACL carrier truth, persists only minimal authz/personalization audit summary, and upgrades eval fixture validation to canonical restricted vocabulary plus program-family / soft-personalization collapse guards.
- Current merged-truth architecture snapshot is now centralized in `docs/architecture/current-architecture.md`; README、docs index、architecture topic docs 与 `.planning/PROJECT.md` 只在各自边界内说明当前真相、长期约束、历史基线和 phase 状态，不再各自维护竞争性的 merged-truth 叙述。
- Repo-level architecture docs are now collapsed to `current-architecture.md`、`target-architecture.md` plus a small supporting set; merged-away architecture notes and completed bootstrap baselines have exited the active docs path.
- Curriculum gate closeout now has canonical docs/runbook coverage in `docs/reference/curriculum-plan-eval-metrics.md` and `docs/runbooks/curriculum-plan-hybrid-rebuild-checklist.md`; fresh live evidence belongs to the root worktree rather than this branch-local follow-up.
- shared `app-api -> supervisor-api` seam is now aligned to `ContextProjection` / `SupervisorResponse`: request payloads no longer depend on actor `snapshot`, `supervisor-api` accepts body `actor/context` after admission, and request projections keep `approval_required` / `rejected` as first-class runtime statuses.
- 2026-04-04 `072912Z` `student_handbook` acceptance rerun 已确认当前 live artifact truth：`deterministic_verdict=pass`、`supplemental_verdict=pass`、`final_overall_verdict=pass`，`repair_run_dir=null`，expanded `11`-case release gate 在真实 provider 上稳定通过。
- handbook post-phase quality line 现已正式关闭：`procedure` action-first answer contract、`procedure_directness`、`student-card / materials / time`、`scholarship-title / medical-title / national-scholarship-alias`、ID-based context metrics 与 prompt adaptation 都已经形成新的 live baseline，而不是仅停留在 repo-head 测试真相。

### Pending Todos

- Keep handbook chunk-truth validation and handbook eval artifacts as reusable regression gates for later retrieval changes.
- Treat the 2026-04-04 `072912Z` handbook acceptance artifact as the current regression baseline for future handbook answer-path or eval-surface changes.
- Treat `.tmp/evals/curriculum-plan-live-gate-accept-20260404T200443Z` as the current latest completed repo-local curriculum artifact truth: deterministic reruns stabilize at `run_pass_counts=[19,19,19]` / `run_failed_counts=[0,0,0]`, `repair_run_dir=null`, and both follow-up session replay cases now pass in all three runs.
- Treat the previous law follow-up repo-head gap as live-closed: the semester course-list answer repair is no longer merely code-closed pending rerun; `.tmp/evals/curriculum-plan-live-gate-accept-20260404T200443Z/run/run-01-case-results.json` through `run-03-case-results.json` all mark `curriculum-release-gate-program-follow-up-session-replay` as `passed=true`.
- Treat `.tmp/evals/curriculum-plan-live-gate-accept-20260404T130027Z` only as an invalid runtime incident record: the rerun was launched on the stabilized local chain, but `wrangler dev` restarted mid-request before full completion, so this artifact must not be treated as latest completed curriculum truth.
- Treat `.tmp/evals/curriculum-plan-live-gate-accept-20260404T045259Z` only as an invalid local runtime incident record: that run was interrupted by `wrangler dev` hot reload and must not be used as benchmark truth.
- Treat `.tmp/evals/curriculum-plan-live-gate-accept-20260404T045929Z` as a superseded but still useful recovery checkpoint: it proved ACL false deny and runtime crash pollution were gone, but its `8/19` result is no longer the current quality baseline.
- Treat `.tmp/evals/curriculum-plan-live-gate-accept-20260404T0950Z` as a superseded historical baseline: it captured the earlier `17/19` state with two follow-up failures, but it is no longer the latest completed full curriculum artifact after the valid `184401Z` rerun.
- Do not force runtime answers to satisfy stale curriculum required facts that are absent from the current alias: the historical law follow-up artifact was actually failing on `习近平法治思想概论` rather than `国际公法`, and `史学理论专题` likewise does not exist in the current `curriculum_plan` serving truth. Repo code/tests now lock the law follow-up required facts to `中国少数民族文字学 / 侵权责任法` and the history strong-base required facts to `大学英语(四) / 中国近代边疆民族史料研读`.
- Treat the history strong-base follow-up code path as locally fixed and now live-verified in the current worktree: direct repo-local retrieval returns `chunk-0014` ahead of truncation, direct `delegate_to_rag_agent` verification keeps `chunk-0010` + `chunk-0014` in final supporting sources, and the valid `184401Z` live rerun no longer shows this case as a deterministic failure.
- Treat `.tmp/evals/student-handbook-formal-benchmark-accept-20260404T020021` only as a superseded recovery incident record: it captured an earlier `retrieval_failed` transient before the later clean pass artifact `.tmp/evals/student-handbook-formal-benchmark-accept-20260404T072912Z`.
- Do not re-propose `official-web` / Phase 10 as the next task in this worktree unless the separate worktree explicitly hands work back; that stream is currently being handled elsewhere.
- Keep `official_web` command/query/handoff tests and operator projections as reusable regression gates for later collector or ingestion integration changes.
- Keep `Jobs` and `Operations` out of the default panel rollout until product scope explicitly re-opens them.
- Treat historical authenticated-notice exports as the current Phase 12 execution substrate; the current worktree now has bounded replay evidence for `2`, `10`, `50`, and `240` notice slices, while `6694` backfill and renewed live portal access remain deferred follow-on work.
- The first planned deployed Worker environment remains `staging@rag.ayafeed.com`: repo-owned `env.staging` config, deploy scripts, and `docs/runbooks/staging-worker-deploy-runbook.md` are landed, but remote Cloudflare resources, secret store values, and post-deploy smoke evidence still do not exist in this worktree’s accepted truth.
- Pending todo: [`.planning/todos/pending/2026-04-04-redeploy-chat-staging-after-auth-runtime-fix.md`] should only execute after staging resources are actually provisioned and `app-api-staging` exists as a real remote surface.
- Pending todo: [`.planning/todos/pending/2026-04-04-provision-real-access-for-panel-staging.md`] remains the future Cloudflare Access step once `panel-staging` is externally provisioned.
- Pending todo: [`.planning/todos/pending/2026-04-04-run-full-staging-live-smoke-and-observability.md`] captures the final full-lane live smoke, evidence, and observability closure after `app-api` and `panel` blockers are removed.

### Blockers/Concerns

- No current phase-1 mainline blocker remains inside this follow-up branch.
- Cloudflare 04.x boundary/topology/contract/shell docs are complete; follow-up work must consume them as frozen handoffs rather than reopening architecture churn.
- `public-consumer-chat` is merged on `main`; downstream work should treat it as a historical implementation reference rather than a live backend direction.
- panel `Requests` is no longer blocked, but panel work must still avoid reading audit logs, telemetry sinks, consumer chat tables, or `apps/supervisor-api` directly.
- `Official Web` control-plane APIs and panel domain are now landed on `apps/app-api` + `apps/protected-panel-web`; follow-up work must extend this surface rather than reintroducing panel-side synthesis or direct infrastructure reads.
- `Jobs` / `Operations` / `Audit` remain delayed; landed `Official Web` views do not authorize a generic ops console.
- Observability runtime code is landed, local worktree env is ready, and the targeted Worker smokes are green. The latest local evidence now lives at `.tmp/observability-smoke/20260402T233916-local-readiness/`. There is no current local-engineering blocker here; the repo truth is that staging remains a repo-owned deploy target definition rather than an already-provisioned remote environment. When staging deployment exists, the smoke runner should use `chat-staging.rag.ayafeed.com`, `panel-staging.rag.ayafeed.com`, `api-staging.rag.ayafeed.com`, the current Worker release identifier, and Sentry/Axiom access; local placeholder URLs such as `chat.example.com`, `panel.example.com`, and `app-api.internal` remain development-only values.
- `student_handbook` 当前最新 release-truth artifact 已更新为 `.tmp/evals/student-handbook-formal-benchmark-accept-20260404T072912Z`；较早的 `20260402T182346`、`181247` 与 `210128` 仍可作为历史健康 baseline 对照，但不再是最新 closeout 证据。
- `student_handbook` 的 repo-local 2026-04-04 rerun 现在已经有新的 clean pass baseline：`.tmp/evals/student-handbook-formal-benchmark-accept-20260404T072912Z` 的 `deterministic_verdict=pass`、`supplemental_verdict=pass`、`final_overall_verdict=pass`，三轮 deterministic run 稳定复现 `run_pass_counts=[11,11,11]` / `run_failed_counts=[0,0,0]`。
- Phase 8 的本地 automated gates 与 fresh handbook live accept 现已全部通过，Phase 09.1 也已补齐 env/bootstrap/provider contract；因此 handbook Phase 8 closeout 现可视为 completed truth。
- 2026-04-03 的 repo-local curriculum / handbook fail artifacts 仍然只应作为历史故障排查参考，不再代表当前状态：本地 `trusted-worker + 8081`、preview rebuild、publish alias、current-row canonicalization，以及 handbook rerun `internal_error` 都已经被后续恢复工作覆盖。
- `curriculum_plan` 的 repo-local 最新 completed accept artifact 现已更新为 `.tmp/evals/curriculum-plan-live-gate-accept-20260404T200443Z`：`deterministic_verdict=pass`、`supplemental_verdict=warn`、`final_overall_verdict=warn`，repair skipped，三轮 deterministic run 全部 `19/19` 通过。当前不再有 deterministic curriculum release gate failure；remaining issue is soft-gated supplemental quality only. Earlier rerun attempt `.tmp/evals/curriculum-plan-live-gate-accept-20260404T130027Z` 仍只应被视为 mid-request restart incident，而不是新的产品质量结论。
- `apps/authenticated-notice-collector` 现在已经补齐 `pyproject.toml`，因此 authenticated-notice 相关 focused verification 可以正常使用 `uv run --package ...`；后续 Phase 12 不应再按“collector 缺 package metadata”这个旧 blocker 规划。
- staging `app-api` auth/runtime instability is now closed in this worktree: request-scoped auth and command-side runtime can read through dedicated `APP_API_DB_FRESH` no-cache Hyperdrive while read-mostly query surfaces stay on `APP_API_DB`; live evidence ` .tmp/staging-smoke/20260404t141510z-app-api-auth-fresh-hyperdrive-live ` confirms `readyz 10/10`, `chat-readyz 10/10`, and `sign-up -> immediate sign-in -> get-session` all `5/5 200`.
- Phase 12.1 freezes two closeout-specific execution rules: authenticated-notice staged checkpoints may only use cumulative full-bundle prefixes because import uses `scope_refresh=(corpus, collection)`, and raw asset registry reconciliation only requires expected ID coverage because raw scope history is retained outside document-scope refresh.
- Phase 9 与 handbook live accept 是两条独立工作流：它复用已落地的 handbook ambiguous-object posture，但本身不依赖新的 handbook acceptance artifact 才能开始规划或执行；当前 09-03 closeout 已把 deictic verified-identity truth、soft-bias-only qrels fast-fail 与 diagnostics 收口为 completed truth。
- curriculum canonical eval truth 现已明确禁止把未裁决短标题歧义锁成单目标 qrels；`民族实验班` 已退出 canonical retrieval qrels，改由 `needs_clarification` workflow case 承担，`campus_evals.retrieval_benchmark` 会在评分前按 split manifest fast-fail 这类坏 truth。
- Phase 9 现在额外固定了两条关键后置约束：`verified major + unique candidate` 才允许 deictic curriculum single-doc resolve，而 `recent_goal` / `confirmed_slot_terms` / profile memory 只能作为 soft bias 或 clarification input；external default query scope 仍旧只开放 `curriculum_plan`。
- Phase 11 is now fully closed: the principal/projection seam, data-plane canonicalization, retrieval fail-close / deny-path leakage prevention, safe personalization wiring, and compatibility / eval / telemetry closure are all landed.

## Recent Verification

- `uv run --package campus-ingestion-worker python -m unittest tests.ingestion.test_closeout_authenticated_notice_historical_backfill_worker tests.ingestion.test_smoke_authenticated_notice_bootstrap_worker tests.ingestion.test_import_authenticated_notice_export_worker tests.ingestion.test_authenticated_notice_import`
- `uv run --package campus-ingestion-worker python -m unittest tests.ingestion.test_authenticated_notice_import tests.ingestion.test_import_authenticated_notice_export_worker tests.ingestion.test_smoke_authenticated_notice_bootstrap_worker tests.ingestion.test_closeout_authenticated_notice_historical_backfill_worker tests.ingestion.test_authenticated_notice_closeout_async tests.ingestion.test_authenticated_notice_closeout_worker`
- `git diff --check -- .planning/ROADMAP.md .planning/STATE.md .planning/phases/12.1-authenticated-notice-historical-backfill-closeout docs/plans/authenticated-notice-historical-backfill-closeout.md docs/runbooks/authenticated-notice-historical-backfill-closeout-runbook.md apps/ingestion-worker/src/campus_ingestion_worker/closeout_authenticated_notice_historical_backfill.py apps/ingestion-worker/src/campus_ingestion_worker/__init__.py tests/ingestion/test_closeout_authenticated_notice_historical_backfill_worker.py`
- `./.venv/bin/python -m unittest tests.ingestion.test_rebuild_local_data tests.ingestion.test_provider_result_replay_rebuild`
- `./.venv/bin/python -m unittest tests.ingestion.test_rebuild_local_data tests.ingestion.test_provider_result_replay_rebuild tests.ingestion.test_campusrag_ingestion_support tests.ingestion.test_registry_models tests.ingestion.test_rebuild_local_data_worker`
- `./.venv/bin/python -m unittest tests.ingestion.test_split_manifest tests.ingestion.test_curriculum_budget_evaluation tests.ingestion.test_rebuild_local_data tests.ingestion.test_campusrag_ingestion_support tests.ingestion.test_process_raw_ingestion_job`
- `UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m unittest tests.specialist.test_rag_specialist.CurriculumQueryPlanningTest`
- `UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m unittest tests.retrieval.test_curriculum_query_resolution`
- `set -a && source .env >/dev/null 2>&1 && set +a && ./.venv/bin/python -m campus_ingestion_worker.release_index --corpus curriculum --collection curriculum_plan --raw-version-id sha256:0416e3d70c48d86238d2869c477ab60407ddbb9a09a76bee57aaeb0c97ab3f67 --source-pdf curriculum-plan-2022.pdf --reset-index --no-publish-alias`
- `set -a && source .env >/dev/null 2>&1 && set +a && ./.venv/bin/python -m campus_ingestion_worker.release_index --corpus curriculum --collection curriculum_plan --raw-version-id sha256:0416e3d70c48d86238d2869c477ab60407ddbb9a09a76bee57aaeb0c97ab3f67 --source-pdf curriculum-plan-2022.pdf --publish-alias`
- `set -a && source .env >/dev/null 2>&1 && source apps/app-api/.dev.vars >/dev/null 2>&1 && export APP_API_BASE_URL=http://127.0.0.1:8787 && export APP_API_EVAL_USER_EMAIL=eval-benchmark@example.edu && set +a && ./.venv/bin/python -m campus_evals.curriculum_live_benchmark accept --reruns 3 --verbose --log-jsonl .tmp/evals/curriculum-runtime-events-20260404T045929Z.run.jsonl --output-dir .tmp/evals/curriculum-plan-live-gate-accept-20260404T045929Z`
- `UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m campus_evals.curriculum_live_benchmark accept --reruns 3 --verbose --log-jsonl .tmp/evals/curriculum-runtime-events-20260404T0950Z.jsonl --output-dir .tmp/evals/curriculum-plan-live-gate-accept-20260404T0950Z`
- `set -a && source .env >/dev/null 2>&1 && source apps/app-api/.dev.vars >/dev/null 2>&1 && export APP_API_BASE_URL=http://127.0.0.1:8787 && set +a && UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m campus_evals.curriculum_live_benchmark accept --reruns 3 --verbose --log-jsonl .tmp/evals/curriculum-runtime-events-20260404T184401Z.run.jsonl --output-dir .tmp/evals/curriculum-plan-live-gate-accept-20260404T184401Z`
- `set -a && source .env >/dev/null 2>&1 && source apps/app-api/.env >/dev/null 2>&1 && source apps/app-api/.dev.vars >/dev/null 2>&1 && export CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_APP_API_DB_FRESH=\"$CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_APP_API_DB\" && export APP_API_BASE_URL=http://127.0.0.1:8787 && set +a && UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m campus_evals.curriculum_live_benchmark accept --reruns 3 --verbose --log-jsonl .tmp/evals/curriculum-runtime-events-20260404T200443Z.run.jsonl --output-dir .tmp/evals/curriculum-plan-live-gate-accept-20260404T200443Z`
- `pnpm --filter app-api test:node -- test/chat.store.test.ts test/runtime-command.store.test.ts test/worker-runtime-cache.test.ts test/worker.test.ts`
- `pnpm --dir apps/app-api test:node -- test/auth-and-db.test.ts test/chat-requests.route.test.ts test/telemetry.axiom.test.ts`
- `pnpm --dir apps/app-api test:worker -- --reporter=verbose test/worker.test.ts test/worker-runtime-cache.test.ts`
- `./.venv/bin/python -m campus_evals.handbook_live_benchmark accept --reruns 3 --verbose --log-jsonl .tmp/evals/student-handbook-runtime-events-20260404T020021.run.jsonl --output-dir .tmp/evals/student-handbook-formal-benchmark-accept-20260404T020021`
- `./.venv/bin/python -m campus_evals.handbook_live_benchmark accept --reruns 3 --verbose --log-jsonl .tmp/evals/student-handbook-runtime-events-20260404T072912Z.run.run.jsonl --output-dir .tmp/evals/student-handbook-formal-benchmark-accept-20260404T072912Z`
- `pnpm --filter app-api typecheck`
- `pnpm --dir apps/app-api typecheck`
- `pnpm --dir apps/app-api typecheck`
- `pnpm --dir apps/app-api test:node`
- `pnpm --dir apps/app-api test:worker -- --reporter=verbose`
- `pnpm --dir apps/app-api exec wrangler deploy --env staging --var SUPERVISOR_API_BASE_URL:https://locale-respiratory-dat-duty.trycloudflare.com`
- `pnpm --filter app-api test:node -- test/principal-resolution.test.ts test/supervisor-adapter.test.ts test/chat-command.service.test.ts test/chat-conversations.service.test.ts test/operator-query.route.test.ts test/projection.service.test.ts test/official-web-e2e.test.ts test/official-web-query.route.test.ts test/chat-requests.route.test.ts test/chat-conversations.route.test.ts`
- `UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m unittest tests.app_api.test_projection tests.contracts.test_models tests.api.test_supervisor_api`
- `UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m unittest tests.ingestion.test_registry_models tests.ingestion.test_campusrag_ingestion_support tests.ingestion.test_processing_pipeline tests.ingestion.test_split_manifest tests.ingestion.test_provider_result_replay_rebuild`
- `uv run --all-packages python -m unittest tests.ingestion.test_campusrag_ingestion_support tests.ingestion.test_rebuild_local_data tests.ingestion.test_provider_result_replay_rebuild tests.ingestion.test_registry_models`
- `UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m unittest tests.retrieval.test_backend_qdrant tests.retrieval.test_service tests.specialist.test_rag_specialist`
- `UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m unittest tests.supervisor.test_supervisor_core tests.supervisor.test_supervisor_routing tests.supervisor.test_supervisor_policy tests.specialist.test_rag_specialist`
- `UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m unittest tests.retrieval.test_service tests.supervisor.test_supervisor_core tests.api.test_supervisor_api tests.evals.test_retrieval_benchmark`
- `UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m unittest tests.retrieval.test_backend_qdrant tests.retrieval.test_service tests.supervisor.test_supervisor_core tests.api.test_supervisor_api tests.evals.test_retrieval_benchmark`
- `env UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m scripts.check_worker_observability_env --json`
- `pnpm --dir apps/app-api test:worker -- --reporter=verbose`
- `pnpm --dir apps/public-chat-web test:worker -- --reporter=verbose -t "smokes a chat request through public-chat-web into app-api"`
- `pnpm --dir apps/protected-panel-web test:worker -- --reporter=verbose -t "smokes request queries through protected-panel-web into app-api with internal caller admission"`
- `git diff --check -- apps/app-api/src/modules/auth/principal.ts apps/app-api/src/modules/auth/index.ts apps/app-api/src/modules/integration/supervisor.ts apps/app-api/src/campus_app_api/projection.py apps/supervisor-api/src/campus_supervisor_api/api.py packages/contracts/src/campus_contracts/models.py apps/app-api/test/principal-resolution.test.ts apps/app-api/test/supervisor-adapter.test.ts apps/app-api/test/chat-command.service.test.ts apps/app-api/test/chat-conversations.service.test.ts apps/app-api/test/operator-query.route.test.ts apps/app-api/test/projection.service.test.ts apps/app-api/test/official-web-e2e.test.ts apps/app-api/test/official-web-query.route.test.ts apps/app-api/test/chat-requests.route.test.ts apps/app-api/test/chat-conversations.route.test.ts tests/app_api/test_projection.py tests/contracts/test_models.py tests/api/test_supervisor_api.py .planning/ROADMAP.md .planning/phases/11-campus-identity-authorization-memory-and-restricted-document-foundation`
- `git diff --check -- packages/supervisor-core/src/campus_supervisor_core/context.py packages/supervisor-core/src/campus_supervisor_core/intent.py packages/supervisor-core/src/campus_supervisor_core/policy.py packages/rag-specialist/src/campus_rag_specialist/intent.py packages/rag-specialist/src/campus_rag_specialist/service.py tests/supervisor/test_supervisor_core.py tests/specialist/test_rag_specialist.py .planning/ROADMAP.md .planning/STATE.md .planning/phases/11-campus-identity-authorization-memory-and-restricted-document-foundation/11-04-SUMMARY.md`
- `git diff --check -- packages/retrieval-core/src/campus_retrieval_core/models.py packages/supervisor-core/src/campus_supervisor_core/audit.py packages/evals/src/campus_evals/benchmark.py tests/retrieval/test_service.py tests/supervisor/test_supervisor_core.py tests/api/test_supervisor_api.py tests/evals/test_retrieval_benchmark.py`
- `uv run --package campus-ingestion-worker python -m unittest tests.ingestion.test_collection_config tests.ingestion.test_corpus_runtime_profile tests.ingestion.test_authenticated_notice_import tests.ingestion.test_import_authenticated_notice_export_worker tests.ingestion.test_smoke_authenticated_notice_bootstrap_worker tests.ingestion.test_campusrag_ingestion_support`
- `uv run --package campus-ingestion-worker python -m campus_ingestion_worker.smoke_authenticated_notice_bootstrap --bundle-path .tmp/authenticated-notice-smoke/20260404T131900-2-timed/notices-bundle-slice-2.json --manifest-path /home/reptilian/code/rag-data/muc-notice-collector/runtime/exports/export-manifest-20260403-run-2.json --site-id muc_internal_portal --source-home-url https://my.muc.edu.cn --expect-notice-count 2 --summary-output-path .tmp/authenticated-notice-smoke/20260404T131900-2-timed/summary.json`
- `uv run --package campus-ingestion-worker python -m campus_ingestion_worker.smoke_authenticated_notice_bootstrap --bundle-path .tmp/authenticated-notice-smoke/20260404T131350-10/notices-bundle-slice-10.json --manifest-path /home/reptilian/code/rag-data/muc-notice-collector/runtime/exports/export-manifest-20260403-run-2.json --site-id muc_internal_portal --source-home-url https://my.muc.edu.cn --expect-notice-count 10 --summary-output-path .tmp/authenticated-notice-smoke/20260404T131350-10/summary.json`
- `uv run --package campus-ingestion-worker python -m campus_ingestion_worker.smoke_authenticated_notice_bootstrap --bundle-path .tmp/authenticated-notice-smoke/20260404T131544-50/notices-bundle-slice-50.json --manifest-path /home/reptilian/code/rag-data/muc-notice-collector/runtime/exports/export-manifest-20260403-run-2.json --site-id muc_internal_portal --source-home-url https://my.muc.edu.cn --expect-notice-count 50 --summary-output-path .tmp/authenticated-notice-smoke/20260404T131544-50/summary.json`
- `pnpm --dir apps/authenticated-notice-collector test`
- `pnpm --dir apps/authenticated-notice-collector typecheck`
- `pnpm --dir apps/authenticated-notice-collector build`
- `uv run --package campus-ingestion-worker python -m unittest tests.ingestion.test_authenticated_notice_import tests.ingestion.test_import_authenticated_notice_export_worker tests.ingestion.test_smoke_authenticated_notice_bootstrap_worker`
- `uv run --package campus-ingestion-worker python -m campus_ingestion_worker.smoke_authenticated_notice_bootstrap --bundle-path .tmp/authenticated-notice-smoke/20260404T152745-240/notices-bundle-slice-240.json --manifest-path /home/reptilian/code/rag-data/muc-notice-collector/runtime/exports/export-manifest-20260403-run-2.json --site-id muc_internal_portal --source-home-url https://my.muc.edu.cn --expect-notice-count 240 --summary-output-path .tmp/authenticated-notice-smoke/20260404T152745-240/summary.json`

## Session Continuity

Last session: 2026-03-29T12:00:00+08:00
Stopped at: canonical local rebuild recovery now has preview/publish artifacts plus handbook rerun-crash fix; next work here is handbook `req_4dc1f3369f2b4c3193cf0fc48b885af5` / `retrieval_failed` triage and curriculum deterministic quality remediation, while deploy-side observability remains pending first real deployment
Resume file: None
