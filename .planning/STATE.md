---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: in_progress
stopped_at: 2026-04-02 phase 09.1 was inserted after confirming current worktree `.env` already contains provider credentials, while ad-hoc processes still fail because they do not auto-bootstrap local env
last_updated: "2026-04-02T16:28:20+08:00"
progress:
  total_phases: 20
  completed_phases: 17
  total_plans: 49
  completed_plans: 45
---

# Project State

## Project Reference

See: `.planning/PROJECT.md` (updated 2026-03-31)

**Core value:** 先把新的 supervisor-led multi-agent 架构站稳，并用 runtime-profile-driven serving surface 证明这条架构能可靠承接高频校园问答
**Current focus:** Phase 09.1 的 4 个执行 plan 已完成：shared bootstrap state、shared provider resolver、surface-aware typed error、`doctor_env` 与 deploy-side provider secret runbook 都已落地。当前 handbook live accept 的阻塞已从“代码/文档漂移”收窄为“需要通过受控入口重跑并产出 fresh acceptance artifact”；下一步应先用 `uv run --all-packages python -m scripts.doctor_env evals --json` 确认当前 worktree 可见性，再重跑 handbook live accept。

## Current Position

Phase: 09.1 (Env Bootstrap And Provider Configuration Governance) — IMPLEMENTED LOCALLY
Plan: 4 of 4

## Performance Metrics

**Velocity:**

- Total plans completed: 45
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

- Last 5 plans: 07-02, 08-01, 08-02, 08-03, 08-04
- Trend: handbook 主链路 hardening 已在 repo 内落地并通过本地 automated gates；当前阻塞点不是实现或架构，而是缺少 `LLM_API_KEY` 导致 live handbook accept 还不能产出新的 acceptance artifact

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
- Phase 8 execution completed locally, but phase closeout remains blocked on live handbook accept credentials
- Phase 9 added: Curriculum Ambiguous Program Query Hardening
- Phase 9 implementation now includes internal `course_facts` serving surface, canonical course/course-family specialist planning, partial-answer diagnostics, and eval/qrels fast-fail coverage for family alias collapse
- Phase 09.1 inserted after Phase 9: Env Bootstrap And Provider Configuration Governance (URGENT)
- Phase 09.1 implementation now includes explicit bootstrap state, shared provider precedence resolution, eval-side surface-aware provider errors, and a non-secret-leaking `doctor_env` command

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
- The detailed `app-api` implementation baseline now lives in `docs/plans/app-api-worker-foundation.md`, including framework selection, API surface, data domains, and execution waves.
- `app-api` 第一版产品层 HTTP contract、`app-api -> supervisor-api` execution contract、request lifecycle、error model 与 logical schema 现已冻结在 `docs/contracts/` 与 `docs/data/`。
- The accepted long-term split now separates verified identity, profile memory, session memory, and institutional knowledge into distinct truth layers.
- Personalization may influence intent framing, retrieval planning, clarification, and answer wording, but memory does not grant permissions or widen retrieval ACL.
- The current merged truth now treats `ContextProjection` + `SupervisorResponse` as the shared seam; follow-up work must preserve that seam instead of reintroducing `snapshot`.
- Curriculum gate closeout now has canonical docs/runbook coverage in `docs/reference/curriculum-plan-eval-metrics.md` and `docs/runbooks/curriculum-plan-hybrid-rebuild-checklist.md`; fresh live evidence belongs to the root worktree rather than this branch-local follow-up.
- shared `app-api -> supervisor-api` seam is now aligned to `ContextProjection` / `SupervisorResponse`: request payloads no longer depend on actor `snapshot`, `supervisor-api` accepts body `actor/context` after admission, and request projections keep `approval_required` / `rejected` as first-class runtime statuses.
- 2026-03-31 `210128` `student_handbook` acceptance rerun 已确认 live artifact truth：`deterministic_verdict=pass`、`supplemental_verdict=pass`、`final_overall_verdict=pass`，`repair` 跳过且无 applied targets，expanded `8`-case release gate 在真实 provider 上稳定通过。
- handbook post-phase quality line 现已正式关闭：`procedure` action-first answer contract、`procedure_directness`、`student-card / materials / time` 三个自然问句 signal、ID-based context metrics 与 prompt adaptation 都已经形成新的 live baseline，而不是仅停留在 repo-head 测试真相。

### Pending Todos

- Keep handbook chunk-truth validation and handbook eval artifacts as reusable regression gates for later retrieval changes.
- Treat the 2026-03-31 `210128` handbook acceptance artifact as the new regression baseline for future handbook answer-path or eval-surface changes.
- Rerun handbook live accept through a repo-shipped or `doctor_env`-verified env path; the current blocker is no longer provider bootstrap design drift, but the absence of a fresh post-refactor acceptance artifact.
- Run full repo verification after the Phase 9 worktree stabilizes, then decide whether to produce fresh curriculum live acceptance artifacts in addition to the current automated evidence.
- Keep `official_web` command/query/handoff tests and operator projections as reusable regression gates for later collector or ingestion integration changes.
- Keep `Jobs` and `Operations` out of the default panel rollout until product scope explicitly re-opens them.
- For the first real deployed Worker environment, confirm deploy-side `SENTRY_*` / `AXIOM_*` assignment for `apps/app-api`, `apps/public-chat-web`, and `apps/protected-panel-web`, then run post-deploy smoke verification for trace propagation, error capture, and minimal runtime event ingest. Local preflight and targeted Worker smoke were revalidated on 2026-03-31, so this is now a deployment gate rather than an active local-engineering blocker.

### Blockers/Concerns

- No current phase-1 mainline blocker remains inside this follow-up branch.
- Cloudflare 04.x boundary/topology/contract/shell docs are complete; follow-up work must consume them as frozen handoffs rather than reopening architecture churn.
- `public-consumer-chat` is merged on `main`; downstream work should treat it as a historical implementation reference rather than a live backend direction.
- panel `Requests` is no longer blocked, but panel work must still avoid reading audit logs, telemetry sinks, consumer chat tables, or `apps/supervisor-api` directly.
- `Official Web` control-plane APIs and panel domain are now landed on `apps/app-api` + `apps/protected-panel-web`; follow-up work must extend this surface rather than reintroducing panel-side synthesis or direct infrastructure reads.
- `Jobs` / `Operations` / `Audit` remain delayed; landed `Official Web` views do not authorize a generic ops console.
- Observability runtime code is landed, local worktree env is ready, and the targeted Worker smokes are green. There is no current local-engineering blocker here; the repo truth is simply that the first real deployed Worker environment does not exist yet, so deploy-side sink verification remains pending by design. When deployment exists, the smoke runner will need real hostnames, a Worker release identifier, and Sentry/Axiom access; local placeholder URLs such as `chat.example.com`, `panel.example.com`, and `app-api.internal` remain development-only values.
- `student_handbook` handbook 质量线已在 `210128` acceptance artifact 上闭环；若后续再出现 handbook 退化，应从这个 baseline 出发分析，而不是回退到更早 `warn` artifact 的诊断框架。
- Phase 8 的本地 automated gates 已全部通过，Phase 09.1 也已补齐 env/bootstrap/provider contract；但在 handbook live accept 通过受控入口重跑并产出 fresh acceptance artifact 前，仍不要把 Phase 8 记为 completed truth。
- Phase 9 与 handbook live accept 是两条独立工作流：它复用已落地的 handbook ambiguous-object posture，但本身不依赖新的 handbook acceptance artifact 才能开始规划或执行。
- curriculum canonical eval truth 现已明确禁止把未裁决短标题歧义锁成单目标 qrels；`民族实验班` 已退出 canonical retrieval qrels，改由 `needs_clarification` workflow case 承担，`campus_evals.retrieval_benchmark` 会在评分前按 split manifest fast-fail 这类坏 truth。
- Phase 9 现在还额外引入了 `course_facts` internal serving surface；课程型问句已不再强行复用 `curriculum_plan` 单-doc evidence 心智，但 external default query scope 仍旧只开放 `curriculum_plan`。

## Session Continuity

Last session: 2026-03-29T12:00:00+08:00
Stopped at: handbook acceptance rerun and stale-truth cleanup are closed; next work is runtime observability verification in the first real deployed Worker environment
Resume file: None
