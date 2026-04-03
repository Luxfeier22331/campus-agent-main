---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: in_progress
stopped_at: 2026-04-03 repo-local curriculum/handbook live accept reruns exposed local runtime/data-plane drift: supervisor auth mode initially mismatched the Worker bridge, and after correcting that the local registry current rows still contained legacy authz payload (`acl_groups`, `campus_scope`), so the next work here is canonical local rebuild plus accept recovery rather than more eval interpretation
last_updated: "2026-04-03T23:45:34+08:00"
progress:
  total_phases: 22
  completed_phases: 21
  total_plans: 54
  completed_plans: 51
---

# Project State

## Project Reference

See: `.planning/PROJECT.md` (updated 2026-04-02)

**Core value:** 先把新的 supervisor-led multi-agent 架构站稳，并用 runtime-profile-driven serving surface 证明这条架构能可靠承接高频校园问答
**Current focus:** Phase 11 与 Phase 9 现已全部完成：Phase 11 已收口 canonical principal/projection seam、restricted data-plane projection、retrieval fail-close / deny-path safety、safe personalization wiring，以及 compatibility / eval / telemetry closure；Phase 9 则补齐了 curriculum alias governance、deictic verified-identity truth、soft-personalization fast-fail 与 eval closeout。`official-web` / Phase 10 当前由其他 worktree 处理，不应在这里被反复重新提议；这个 worktree 当前的非 web 优先项是先恢复 repo-local handbook/curriculum live accept 的有效性，方法是纠正本地 supervisor trusted-worker bootstrap、重建 canonical local registry/index truth、再 rerun accept，然后再回到 deploy-side observability verification 与其他 curriculum deferred follow-ups。

## Current Position

Phase: 09 (Curriculum Ambiguous Program Query Hardening) — COMPLETED
Plan: 3 of 3 completed (`09-01` ~ `09-03` verified)
Next active workstream: canonical local registry rebuild plus handbook/curriculum live accept recovery, followed by deploy-side observability verification; `official-web` / Phase 10 is tracked in a separate worktree

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
- Trend: Phase 11 与 Phase 9 已完成 closeout；当前这个 worktree 的主线风险转为 deploy-side observability 与 curriculum deferred work，`official-web` / Phase 10 由其他 worktree 承接

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
- Protected panel request visibility is now fixed on shared `apps/app-api`: panel `Requests` must consume the shipped runtime-owned query surface and must not route around it through `apps/supervisor-api`, audit logs, telemetry sinks, or consumer chat tables.
- canonical request projection is now explicitly same-database outbox-first: `runtime.request_execution` plus `runtime.projection_outbox` are the first durable truth, while queues are optional later acceleration only.
- Better Auth is now fixed inside `apps/app-api`, and `auth/chat/runtime/operator` are expected to share one Drizzle schema codebase plus one migration pipeline; Worker runtime DB access remains Hyperdrive-based while migrations use a direct management connection.
- Protected panel operator access is now explicitly documented as a small-team operator surface without a self-serve end-user account system; `Jobs` and `Operations` remain delayed pending re-discussion.
- shared `apps/app-api` Worker foundation, request projection APIs, and current web-surface wiring are now implemented in merged truth; remaining work is follow-up hardening rather than topology bootstrap.
- `official_web` control plane is now implemented on `apps/app-api` with dedicated schema, collector command/query endpoints, outbox-driven operator projections, and scheduled ingestion handoff dispatch; `apps/protected-panel-web` now consumes the owned site/run/detail APIs instead of treating `Official Web` as a blocked next domain.
- Phase 05.1 froze curriculum source-truth quality gates, split-manifest review fail-close behavior, and explicit chunking runtime truth.
- Phase 06 added `provider_response_replay` rebuild support for `curriculum_plan`, and the current refactor promotes its serving policy into the profile-driven query surface.
- Phase 07 closed handbook release-gate verification with repo tests, live qrels benchmark, workflow/status samples, and handbook collection schema evidence under `.tmp/phase7/`.
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
- 2026-04-02 `182346` `student_handbook` acceptance rerun 已确认当前 live artifact truth：`deterministic_verdict=pass`、`supplemental_verdict=pass`、`final_overall_verdict=pass`，`repair_run_dir=null`，expanded `11`-case release gate 在真实 provider 上稳定通过。
- handbook post-phase quality line 现已正式关闭：`procedure` action-first answer contract、`procedure_directness`、`student-card / materials / time`、`scholarship-title / medical-title / national-scholarship-alias`、ID-based context metrics 与 prompt adaptation 都已经形成新的 live baseline，而不是仅停留在 repo-head 测试真相。

### Pending Todos

- Keep handbook chunk-truth validation and handbook eval artifacts as reusable regression gates for later retrieval changes.
- Treat the 2026-04-02 `182346` handbook acceptance artifact as the current regression baseline for future handbook answer-path or eval-surface changes.
- Recover the repo-local handbook/curriculum live accept path by replay rebuild plus alias re-publish; the 2026-04-03 local fail artifacts are currently runtime-polluted and must not be read as product-quality regression evidence until canonical local data-plane truth is restored.
- Do not re-propose `official-web` / Phase 10 as the next task in this worktree unless the separate worktree explicitly hands work back; that stream is currently being handled elsewhere.
- Keep `official_web` command/query/handoff tests and operator projections as reusable regression gates for later collector or ingestion integration changes.
- Keep `Jobs` and `Operations` out of the default panel rollout until product scope explicitly re-opens them.
- For the first real deployed Worker environment, confirm deploy-side `SENTRY_*` / `AXIOM_*` assignment for `apps/app-api`, `apps/public-chat-web`, and `apps/protected-panel-web`, then run post-deploy smoke verification for trace propagation, error capture, and minimal runtime event ingest. Local preflight and targeted Worker smoke were revalidated again on 2026-04-02, and the handoff/evidence skeleton now lives in `docs/runbooks/worker-observability-smoke-artifact-template.md`, so this is a deployment gate rather than an active local-engineering blocker.

### Blockers/Concerns

- No current phase-1 mainline blocker remains inside this follow-up branch.
- Cloudflare 04.x boundary/topology/contract/shell docs are complete; follow-up work must consume them as frozen handoffs rather than reopening architecture churn.
- `public-consumer-chat` is merged on `main`; downstream work should treat it as a historical implementation reference rather than a live backend direction.
- panel `Requests` is no longer blocked, but panel work must still avoid reading audit logs, telemetry sinks, consumer chat tables, or `apps/supervisor-api` directly.
- `Official Web` control-plane APIs and panel domain are now landed on `apps/app-api` + `apps/protected-panel-web`; follow-up work must extend this surface rather than reintroducing panel-side synthesis or direct infrastructure reads.
- `Jobs` / `Operations` / `Audit` remain delayed; landed `Official Web` views do not authorize a generic ops console.
- Observability runtime code is landed, local worktree env is ready, and the targeted Worker smokes are green. The latest local evidence now lives at `.tmp/observability-smoke/20260402T233916-local-readiness/`. There is no current local-engineering blocker here; the repo truth is simply that the first real deployed Worker environment does not exist yet, so deploy-side sink verification remains pending by design. When deployment exists, the smoke runner will need real hostnames, a Worker release identifier, and Sentry/Axiom access; local placeholder URLs such as `chat.example.com`, `panel.example.com`, and `app-api.internal` remain development-only values.
- `student_handbook` 当前最新 release-truth artifact 已更新为 `.tmp/evals/student-handbook-formal-benchmark-accept-20260402T182346`；`181247` 与 `210128` 仍可作为历史健康 baseline 对照，但不再是最新 closeout 证据。
- Phase 8 的本地 automated gates 与 fresh handbook live accept 现已全部通过，Phase 09.1 也已补齐 env/bootstrap/provider contract；因此 handbook Phase 8 closeout 现可视为 completed truth。
- 2026-04-03 的 repo-local curriculum / handbook accept rerun 当前不能被直接解读成质量退化：先是本地 `supervisor-api` 按 `bearer + 8080` 误启动，随后即便切到 `trusted-worker + 8081`，runtime 仍会因为 local registry current rows 含 `acl_groups` / `campus_scope` 而在 retrieval path 抛异常；下一步应走 canonical local rebuild / alias re-publish，而不是给 runtime query path 加回 legacy carrier 兼容。
- Phase 9 与 handbook live accept 是两条独立工作流：它复用已落地的 handbook ambiguous-object posture，但本身不依赖新的 handbook acceptance artifact 才能开始规划或执行；当前 09-03 closeout 已把 deictic verified-identity truth、soft-bias-only qrels fast-fail 与 diagnostics 收口为 completed truth。
- curriculum canonical eval truth 现已明确禁止把未裁决短标题歧义锁成单目标 qrels；`民族实验班` 已退出 canonical retrieval qrels，改由 `needs_clarification` workflow case 承担，`campus_evals.retrieval_benchmark` 会在评分前按 split manifest fast-fail 这类坏 truth。
- Phase 9 现在额外固定了两条关键后置约束：`verified major + unique candidate` 才允许 deictic curriculum single-doc resolve，而 `recent_goal` / `confirmed_slot_terms` / profile memory 只能作为 soft bias 或 clarification input；external default query scope 仍旧只开放 `curriculum_plan`。
- Phase 11 is now fully closed: the principal/projection seam, data-plane canonicalization, retrieval fail-close / deny-path leakage prevention, safe personalization wiring, and compatibility / eval / telemetry closure are all landed.

## Recent Verification

- `pnpm --filter app-api typecheck`
- `pnpm --filter app-api test:node -- test/principal-resolution.test.ts test/supervisor-adapter.test.ts test/chat-command.service.test.ts test/chat-conversations.service.test.ts test/operator-query.route.test.ts test/projection.service.test.ts test/official-web-e2e.test.ts test/official-web-query.route.test.ts test/chat-requests.route.test.ts test/chat-conversations.route.test.ts`
- `UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m unittest tests.app_api.test_projection tests.contracts.test_models tests.api.test_supervisor_api`
- `UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m unittest tests.ingestion.test_registry_models tests.ingestion.test_campusrag_ingestion_support tests.ingestion.test_processing_pipeline tests.ingestion.test_split_manifest tests.ingestion.test_provider_result_replay_rebuild`
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

## Session Continuity

Last session: 2026-03-29T12:00:00+08:00
Stopped at: local Worker observability readiness has been revalidated and templated; next work here is the first real post-deploy sink verification once environment inputs exist, plus curriculum deferred follow-ups
Resume file: None
