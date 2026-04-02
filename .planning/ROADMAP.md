# Roadmap: Campus Agent

> Historical scheduling record. Use this file for phase ordering, completion history, and archived execution framing.
> For current serving surface, current indexing semantics, and active priorities, prefer `.planning/PROJECT.md`, `.planning/REQUIREMENTS.md`, and `.planning/STATE.md`.

## Overview

This roadmap records the historical execution sequence that stabilized the new supervisor-led architecture before later serving-surface and product-topology refactors landed. The sequence starts by freezing the supervisor/specialist contract and the initial guardrails, then builds the `student_handbook` ingestion and retrieval path, wires the `supervisor` entrypoint with ACL/audit responsibilities, prepares `curriculum_plan`, later promotes serving policy to the collection runtime profile, and finishes with repository-level verification that proves the end-to-end agentic RAG flow is safe to plan and execute.

The phase names below are retained as execution-history labels. They must not be read as the current serving-surface truth, current query-enabled scope, or current product topology. Inserted `03.1`, `03.2`, and `04.x` phases remain here only as historical labels for how that execution order evolved.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (03.1, 04.1, 04.2, 04.3, 04.4, 04.5, 04.6, 04.7, 05.1, 09.1): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Contract And Boundary Guardrails** - Freeze phase-1 supervisor/specialist contracts and corpus-policy limits. (completed 2026-03-23)
- [x] **Phase 2: Student Handbook Raw Ingestion** - Land stable raw ingestion identity and versioning for `student_handbook`. (completed 2026-03-24)
- [x] **Phase 3: Retrieval Corpus Preparation** - Produce processed, chunked, and indexed `student_handbook` artifacts for query-serving. (completed 2026-03-24)
- [x] **Phase 03.1: Availability Specialist 最小闭环** - Generalize the supervisor/specialist boundary enough to add an allowlisted `official-web` / `availability` specialist without collapsing back into supervisor inline tools. (completed 2026-03-25)
- [x] **Phase 03.2: Source Truth Fan-Out And Attachment Projection** - Freeze and implement the single-source-consumption fan-out architecture so one raw source produces all declared downstream projections, including attachment-derived documents, without later raw re-consumption.
- [x] **Phase 4: RAG Specialist Answer Path** - Deliver grounded `student_handbook` retrieval and answer semantics inside `rag-specialist`, using the updated hybrid retrieval baseline (`dense + sparse + RRF`) instead of the old dense-only bootstrap. (completed 2026-03-27)
- [x] **Phase 04.1: Cloudflare Entry And Protected Internal Panel Design** - Freeze the Cloudflare public-entry and protected internal-panel boundary without changing core query contracts. (INSERTED) (completed 2026-03-25)
- [x] **Phase 04.2: Cloudflare Runtime Topology And Delivery Shape** - Freeze the Cloudflare-to-runtime deployment topology, origin ownership, and delivery boundary for public entry and protected panel. (INSERTED) (completed 2026-03-25)
- [x] **Phase 04.3: Public Entry Edge Integration Contract** - Freeze the runtime-level integration contract between Cloudflare public entry and `apps/supervisor-api`. (INSERTED) (completed 2026-03-25)
- [x] **Phase 04.4: Protected Internal Panel Runtime Shell** - Freeze the implementation shape of the protected panel as a future `apps/` runtime shell that only consumes runtime APIs. (INSERTED) (completed 2026-03-25)
- [x] **Phase 04.5: Cloudflare Worker Consumer Entry And Access Policy** - Freeze the Worker-only public consumer-entry seam, access modes, and Worker-to-origin trust policy for the public answer path. (INSERTED) (completed 2026-03-25)
- [x] **Phase 04.6: Cloudflare Worker Runtime Implementation** - Implement the Cloudflare Worker public-entry shell against the frozen 04.3 and 04.5 runtime contracts without absorbing Phase 5 actor, ACL, or audit ownership. (INSERTED) (completed 2026-03-25)
- [x] **Phase 04.7: Public Consumer Chat App Design** - Freeze the first-version public consumer chat app shape, repo boundary, and implementation breakdown so the user-facing product can be built on top of the Worker public-entry seam without reopening panel or Phase 5 ownership questions. (INSERTED) (completed 2026-03-27)
- [x] **Phase 5: Supervisor Entry, ACL, And Audit** - Make `supervisor` the only query entrypoint with routing, identity propagation, and audit traces. (completed 2026-03-27)
- [x] **Phase 05.1: Curriculum Chunking Boundary Freeze** - Freeze `curriculum_plan` source-truth quality gates, split boundaries, and offline chunking runtime truth without opening query-serving. (INSERTED) (completed 2026-03-27)
- [x] **Phase 6: Curriculum Offline Preparation** - Prepare `curriculum_plan` ingestion outputs without opening query-serving. (completed 2026-03-27)
- [x] **Phase 7: Verification And Release Gate** - Prove the main path and failure semantics with automated tests and smoke/eval coverage. (completed 2026-03-27)
- [x] **Phase 8: Student Handbook Ambiguous Policy Query Hardening** - Harden ambiguous `student_handbook` policy-object queries with targeted retrieval, fail-closed clarification/no-answer semantics, and operator-facing diagnostics. (completed 2026-04-02)
- [x] **Phase 9: Curriculum Ambiguous Program Query Hardening** - Harden ambiguous `curriculum_plan` program-family queries with alias-tier governance, family-aware membership truth, and fail-closed deictic/doc resolution. (completed 2026-04-02)
- [x] **Phase 09.1: Env Bootstrap And Provider Configuration Governance** - Freeze and implement explicit local/deploy env bootstrap, provider precedence, and fail-fast diagnostics so provider credentials no longer depend on implicit shell state. (INSERTED) (completed 2026-04-02)
- [ ] **Phase 10: Official Web Repo Hardening And Expansion** - Expand and harden the `official_web` repo-level source channel, control plane, and operator workflow after the current curriculum hardening wave.

## Phase Details

### Phase 1: Contract And Boundary Guardrails
**Historical execution goal**: Freeze the shared handoff contract and corpus-policy rules so the initial execution path remains limited to `student_handbook` and supervisor-core does not absorb retrieval concerns.
**Depends on**: Nothing (first phase)
**Requirements**: [ORCH-02, ORCH-03, GOV-03]
**Success Criteria** (what must be TRUE):
  1. `supervisor-core` and `rag-specialist` communicate only through shared contract types in `packages/contracts`.
  2. The then-current route policy rejects corpora outside `student_handbook`.
  3. `apps/supervisor-api` stays limited to transport/auth/runtime concerns and does not own orchestration rules.
**Plans**: 2/2 plans complete

Plans:
- [x] 01-01: Audit and harden the existing supervisor-specialist contract, routing, and audit invariants.
- [x] 01-02: Lock API-shell boundaries and align supervisor-core package docs with the accepted current-design state.

### Phase 2: Student Handbook Raw Ingestion
**Goal**: Ingest `student_handbook` sources into raw storage with stable identity and version metadata that downstream processing can trust.
**Depends on**: Phase 1
**Requirements**: [ING-01]
**Success Criteria** (what must be TRUE):
  1. `student_handbook` source files can be imported into the raw ingestion path.
  2. Every raw document carries stable document identity and version metadata.
  3. Re-ingestion can distinguish updates from duplicate inputs.
**Plans**: 2 plans

Plans:
- [x] 02-01: Implement raw document registration and metadata persistence for `student_handbook`.
- [x] 02-02: Add validation and fixtures covering raw ingestion identity/version behavior.

### Phase 3: Retrieval Corpus Preparation
**Goal**: Transform `student_handbook` raw inputs into processed text plus chunk/index artifacts ready for retrieval query-serving.
**Depends on**: Phase 2
**Requirements**: [ING-02]
**Success Criteria** (what must be TRUE):
  1. `student_handbook` raw inputs can be converted into cleaned processed text.
  2. Processed outputs can be chunked with metadata suitable for evidence tracing.
  3. Retrieval-ready index artifacts are produced without leaking indexing details into supervisor packages.
**Plans**: 2 plans

Plans:
- [x] 03-01: Implement processed-text and chunk-generation flow for `student_handbook`.
- [x] 03-02: Produce retrieval-ready indexing artifacts and metadata needed for citations.

### Phase 03.1: Availability Specialist 最小闭环 (INSERTED)

**Goal**: Generalize the shared supervisor/specialist contract and routing baseline just enough to land a real non-RAG `availability-specialist` for allowlisted official-web reachability checks.
**Requirements**: [AORC-03]
**Depends on**: Phase 3
**Success Criteria** (what must be TRUE):
  1. `packages/contracts` and `packages/supervisor-core` no longer hardcode rag-only delegation as the only possible specialist path.
  2. A standalone `availability-specialist` can check allowlisted official-web targets and return typed observation results without being embedded into `rag-specialist` or supervisor tool bundles.
  3. Unreachable or failing targets are represented as successful observations with explicit status semantics, while true execution/configuration faults remain `error`.
**Plans**: 3/3 plans complete

Plans:
- [x] 03.1-01: Generalize shared contracts and supervisor routing targets for explicit non-RAG specialist delegation.
- [x] 03.1-02: Implement the allowlisted `availability-specialist` MVP and its observation/status mapping.
- [x] 03.1-03: Add focused routing/tests and a minimal smoke or eval slice for the availability path.

### Phase 03.2: Source Truth Fan-Out And Attachment Projection (INSERTED)
**Goal**: Freeze and execute the source-truth-first ingestion architecture so one raw source is consumed once, persisted as canonical source truth, and then fans out into all declared downstream projections, including handbook attachments and service-like derived documents, without returning to raw for later collection work.
**Depends on**: Phase 03.1
**Requirements**: []
**Success Criteria** (what must be TRUE):
  1. The repo has one canonical `raw -> source truth -> multi-projection fan-out -> document/chunk/index` design, and future downstream collections are forbidden from re-consuming the same raw asset just to derive new projections.
  2. Attachments, appendices, forms, and navigation-like handbook leaves that have standalone downstream value are modeled as explicit derived documents with stable parent/source linkage instead of existing only as cleanup semantics or post-hoc migration output.
  3. Rebuild/replay semantics are defined around persisted source truth plus registry provenance, and handbook-derived `campus_services` outputs align to the same ingestion contract instead of a separate migration-only lane.
  4. The phase produces implementation-ready work breakdown covering architecture/config freeze first, then ingestion-core / worker / replay / verification convergence.
**Plans**: 2 plans

Plans:
- [x] 03.2-01: Freeze the source-truth fan-out architecture, projection config, and derived-document identity/metadata contract.
- [x] 03.2-02: Unify worker/replay/migration execution around source-truth projections and add verification for attachment-derived outputs.

### Phase 4: RAG Specialist Answer Path
**Goal**: Deliver the retrieval-oriented `rag-specialist` behavior for `student_handbook`, including grounded answers, citations, clarification, and no-answer/error handling, on top of the generalized specialist boundary frozen before it.
**Depends on**: Phase 03.1
**Requirements**: [QRY-01, QRY-02, QRY-03, QRY-04]
**Success Criteria** (what must be TRUE):
  1. A `student_handbook` question can return a grounded answer from `rag-specialist`.
  2. Successful answers include citations or equivalent source identifiers linked to supporting evidence.
  3. Ambiguous questions return `needs_clarification` instead of a guessed answer.
  4. Retrieval failures or insufficient evidence return `no_answer` or `error` with safe response shaping.
  5. Retrieval evidence is produced by the accepted hybrid baseline (`dense + sparse + RRF + registry back-link`) rather than the earlier dense-only bootstrap.
**Plans**: 3/3 plans complete

Plans:
- [x] 04-01: Implement retrieval request framing and hybrid evidence selection inside `rag-specialist`.
- [x] 04-02: Shape `completed` responses with citations and confidence-driven answer assembly.
- [x] 04-03: Implement `needs_clarification`, `no_answer`, and `error` branches for unsafe or insufficient retrieval outcomes.

### Phase 04.7: Public Consumer Chat App Design (INSERTED)

**Goal:** Freeze the first-version public consumer chat app shape, repo boundary, and implementation breakdown so the user-facing product can be built on top of the Worker public-entry seam without reopening panel or Phase 5 ownership questions.
**Requirements**: []
**Depends on:** Phase 04.6
**Success Criteria** (what must be TRUE):
  1. The repo has a canonical design truth for a chat-first consumer app with sidebar conversation history, a primary chatbox, and app-level user session UX.
  2. The design makes the app an `apps/*` consumer-facing runtime surface that stays separate from `apps/public-entry-worker`, `apps/supervisor-api`, and `packages/*`.
  3. The phase produces an implementation-ready breakdown covering app shell, auth/session, conversation ownership, chat interaction, and runtime API seam, while keeping Phase 5 actor/ACL/audit work explicitly deferred.
  4. The phase explicitly freezes the MVP as authenticated-first and closes the browser-to-answer transport decision for v1 instead of deferring same-site versus cross-origin behavior to later implementation.
  5. The phase freezes app-line auth/storage ownership as `Better Auth + Supabase Postgres`, with auth/chat sharing one relational boundary and Qdrant remaining the retrieval store.
  6. The phase freezes the frontend host as `TanStack Start`, so the consumer app owns its own full-stack route/auth/session/conversation boundary.
**Plans:** 2/2 plans complete

**Completion Note:** PR #4 merged the `apps/public-consumer-chat` implementation, README baseline, and app-local documentation guardrails into `main` on 2026-03-27. Those 04.7 handoff notes now remain historical reference material, while the forward-looking product topology has since been superseded by the shared `app-api` plus Worker web surface design.

Plans:
- [x] 04.7-01-PLAN.md — Freeze the consumer-app boundary handoff for repo shape, routes, states, and ownership splits.
- [x] 04.7-02-PLAN.md — Freeze the downstream implementation handoff and build order for app shell, auth/session, conversations, chat UX, and runtime seam.

### Phase 04.5: Cloudflare Worker Consumer Entry And Access Policy (INSERTED)

**Goal:** Freeze the Cloudflare Worker as the only public consumer-entry shell for the public answer hostname, including authenticated-only and anonymous-enabled entry modes, trusted Worker-to-origin admission, and explicit fail-closed closure of alternate public entrypoints.
**Requirements**: []
**Depends on:** Phase 4
**Success Criteria** (what must be TRUE):
  1. A canonical architecture note freezes `public hostname -> Cloudflare Route -> Cloudflare Worker -> trusted origin/apps/supervisor-api` as the only public answer entry code path.
  2. The entry policy explicitly supports `authenticated-only` mode and `anonymous-enabled` mode behind an explicit Worker flag without treating edge identity as final app-layer actor semantics.
  3. Worker-to-origin trust, fail-closed behavior, and closure of `workers.dev` and preview URLs are explicit, while Phase 5 actor/ACL/audit work remains deferred.
**Plans:** 2/2 plans complete

Plans:
- [x] 04.5-01-PLAN.md — Freeze the canonical Worker consumer-entry/access-policy note and align docs index plus roadmap.
- [x] 04.5-02-PLAN.md — Freeze the downstream Worker implementation handoff and fail-closed checklist.

### Phase 04.6: Cloudflare Worker Runtime Implementation (INSERTED)

**Goal:** Implement the Route-based Cloudflare Worker public-entry runtime shell in front of `apps/supervisor-api`, preserving the frozen entry modes, trusted-origin seam, and alternate-entry closure without absorbing Phase 5 actor/ACL/audit scope.
**Requirements**: [EDGE-01, EDGE-02]
**Depends on:** Phase 04.5
**Success Criteria** (what must be TRUE):
  1. A dedicated Worker runtime shell exists under `apps/*` and fronts the public hostname via Cloudflare Route rather than pushing provider semantics into `packages/*`.
  2. The Worker enforces exactly `authenticated-only` and `anonymous-enabled`, validates Access JWTs when required, injects trusted origin auth, and closes `workers.dev` plus preview URLs fail-closed.
  3. `apps/supervisor-api` can run behind the Worker in an explicit trusted-origin mode that rejects missing or invalid Worker-auth material without claiming Phase 5 actor, ACL, or audit closure.
**Plans:** 3/3 plans complete

Plans:
- [x] 04.6-01-PLAN.md — Scaffold the standalone `apps/public-entry-worker` runtime shell, toolchain, Route config, and fail-closed placeholder entry.
- [x] 04.6-02-PLAN.md — Implement Worker entry-mode enforcement, Access JWT validation, allowlisted forwarding, and trusted-origin injection with focused Worker tests.
- [x] 04.6-03-PLAN.md — Patch `apps/supervisor-api` for explicit trusted-worker origin auth, env wiring, and focused API tests.

### Phase 04.1: Cloudflare Entry And Protected Internal Panel Design (INSERTED)

**Goal:** Freeze the Cloudflare public-entry and protected internal-panel boundary before implementation work, without changing the `supervisor -> specialist -> retrieval` contract path or leaking runtime specifics into core packages.
**Requirements**: []
**Depends on:** Phase 4
**Success Criteria** (what must be TRUE):
  1. The Cloudflare public-entry boundary is explicitly defined, including how it fronts `apps/supervisor-api` without moving orchestration logic into the edge shell.
  2. The internal panel protection model is frozen, with identity and authorization requirements that keep the panel non-public by default and suitable for Cloudflare-protected access.
  3. The design explicitly separates edge/panel protection from Phase 5 query-path ACL/audit work and does not require changes to `packages/contracts`, `packages/supervisor-core`, or retrieval/data-plane boundaries.
**Plans:** 3/3 plans complete

Plans:
- [x] 04.1-01: Freeze the Cloudflare public-entry boundary in front of `apps/supervisor-api`.
- [x] 04.1-02: Freeze the protected internal-panel trust model and allowed runtime path.
- [x] 04.1-03: Record the deferred Phase 5 actor/ACL/audit seams and implementation handoff.

### Phase 04.2: Cloudflare Runtime Topology And Delivery Shape (INSERTED)

**Goal:** Freeze the Cloudflare-to-runtime deployment topology for public entry and protected panel so later delivery work has explicit origin ownership, hostname routing, secret/config boundaries, and rollback seams without binding `packages/*` to any provider or framework type.
**Requirements**: []
**Depends on:** Phase 04.1
**Success Criteria** (what must be TRUE):
  1. The topology between Cloudflare, public entry, protected panel, and repo-owned runtime origins is explicitly documented.
  2. Delivery ownership for hostname, secret/config, origin routing, and rollback boundary is explicit at the `apps/*` level.
  3. The topology does not reopen `packages/contracts`, supervisor routing semantics, or Phase 5 identity/audit scope.
**Plans:** 2/2 plans complete

Plans:
- [x] 04.2-01: Freeze the Cloudflare-to-origin runtime topology and rollback boundary.
- [x] 04.2-02: Freeze delivery ownership and downstream handoff for 04.3/04.4.

### Phase 04.3: Public Entry Edge Integration Contract (INSERTED)

**Goal:** Freeze the runtime-facing integration contract between Cloudflare public entry and `apps/supervisor-api`, including request forwarding, trace propagation, timeout/cache/streaming expectations, and health/readiness seams.
**Requirements**: []
**Depends on:** Phase 04.2
**Success Criteria** (what must be TRUE):
  1. Cloudflare public entry to `apps/supervisor-api` forwarding expectations are explicit and runtime-scoped.
  2. Header, request-id/trace, cache, body-size, timeout, and streaming expectations are documented without leaking edge/provider concerns into `packages/*`.
  3. Health/readiness and rollback behavior are explicit at the runtime boundary.
**Plans:** 2/2 plans complete

Plans:
- [x] 04.3-01: Freeze the public-entry runtime integration contract between Cloudflare and `apps/supervisor-api`.
- [x] 04.3-02: Freeze the downstream implementation handoff for forwarding, trace, timeout/cache, streaming, and runtime-seam health rules.

### Phase 04.4: Protected Internal Panel Runtime Shell (INSERTED)

**Goal:** Freeze the implementation shape of the protected internal panel as a future `apps/` runtime shell, including runtime API seams, non-goals, and fail-closed delivery assumptions, without turning it into a direct package consumer or business-workflow phase.
**Requirements**: []
**Depends on:** Phase 04.2
**Success Criteria** (what must be TRUE):
  1. The future panel is explicitly modeled as an `apps/` runtime shell and not as an extension of `apps/supervisor-api` or `packages/*`.
  2. The allowed runtime API seams and fail-closed delivery assumptions are explicit.
  3. Panel implementation shape remains separated from Phase 5 actor/ACL/audit work and from panel-side business workflow design.
**Plans:** 2/2 plans complete

Plans:
- [x] 04.4-01: Freeze the protected internal panel as a future `apps/` runtime shell with a runtime-API-only seam and forbidden coupling rules.
- [x] 04.4-02: Freeze the downstream implementation handoff for panel shell ownership, fail-closed behavior, and deferred UI/business/governance scope.

### Phase 5: Supervisor Entry, ACL, And Audit
**Goal**: Make `supervisor` the only supported query entrypoint and wire end-to-end identity, routing, tracing, and audit projection for phase-1 requests.
**Depends on**: Phase 4
**Requirements**: [ORCH-01, GOV-01, GOV-02]
**Success Criteria** (what must be TRUE):
  1. Query traffic enters through a supervisor-facing request contract and is routed by `supervisor`, rather than by API-shell hardcoded specialist construction.
  2. Caller identity and group information reach retrieval-time ACL filtering before evidence is returned.
  3. Each handled request records trace and audit fields covering caller identity, route, response status, and cited sources.
**Plans**: 3/3 plans complete

Plans:
- [x] 05-01: Wire supervisor-api runtime requests into supervisor-core framing and route evaluation.
- [x] 05-02: Propagate identity/groups into retrieval ACL decisions through the handoff contract.
- [x] 05-03: Add audit projection and trace recording for routed supervisor requests.

### Phase 05.1: 研究 curriculum 的 chunking 策略 (INSERTED)

Historical execution goal: freeze the then-offline `curriculum_plan` source-truth quality gate, split-manifest document boundary, and explicit chunking runtime truth before any later serving-policy refactor.
**Requirements**: []
**Depends on:** Phase 5
**Success Criteria** (what must be TRUE):
  1. Real `provider-response -> source-truth` normalization is regression-tested and curriculum source-truth rows have an explicit quality gate.
  2. Split-manifest review helpers fail closed when heading/title evidence is ambiguous and keep logical documents as the pre-chunking boundary.
  3. Curriculum chunking runtime truth is explicit in ingestion-core and loaded from collection runtime truth instead of inheriting handbook defaults.
  4. During 05.1 execution, `curriculum_plan` remains `offline_preparation` with `retrieval_enabled = false` and `query_enabled_by_default = false`.
**Plans:** 4/4 plans complete

Plans:
- [x] 05.1-01-PLAN.md — 对齐 `curriculum/curriculum_plan` 当时的 offline-preparation docs/config/runtime boundary，明确 split boundary 与 config truth。
- [x] 05.1-02-PLAN.md — 补齐真实 `provider-response -> source-truth` 回归与 curriculum source-truth 质量门禁，不再只依赖已生成的 `layout-elements` 样本回归。
- [x] 05.1-03-PLAN.md — 强化 split-manifest 与 source-truth 的 review/fail-closed 衔接，先稳定 document boundary，再冻结 review seam。
- [x] 05.1-04-PLAN.md — 在 source-truth 与 split boundary 稳定后，收口 curriculum chunking runtime truth 与自动化验证。

### Phase 6: Curriculum Offline Preparation
Historical execution goal: prepare `curriculum_plan` raw, processed, and chunk outputs as an offline data-plane path before the later profile-driven serving-surface refactor.
**Depends on**: Phase 05.1
**Requirements**: [ING-03]
**Success Criteria** (what must be TRUE):
  1. `curriculum_plan` documents can be imported into the offline ingestion path.
  2. `curriculum_plan` can be cleaned and chunked using the same data-plane conventions as `student_handbook`.
  3. At Phase 6 closeout, no production query-serving route yet exposed `curriculum_plan`.
**Plans**: 2/2 plans complete

Plans:
- [x] 06-01: Add raw/processed/chunk support for `curriculum_plan` in ingestion flows.
- [x] 06-02: Verify query-serving policy continues to exclude `curriculum_plan` after offline prep is added.

### Phase 7: Verification And Release Gate
**Historical execution goal**: Establish repository-level proof that the then-current end-to-end main path behaves correctly and regressions are caught before release.
**Depends on**: Phase 6
**Requirements**: [VER-01, VER-02]
**Success Criteria** (what must be TRUE):
  1. Automated tests cover the `supervisor -> rag-specialist -> retrieval` flow and all terminal response semantics.
  2. Smoke or eval coverage exercises the `student_handbook` query path and ingestion path.
  3. Verification outputs are repeatable enough to serve as a release gate for phase-1 changes.
**Plans**: 2/2 plans complete

Plans:
- [x] 07-01: Add and stabilize automated test coverage for happy-path and failure-path supervisor/rag interactions.
- [x] 07-02: Add smoke/eval verification for `student_handbook` ingestion and query-serving behavior.

Post-phase closeout note:
- 2026-04-02 `182346` fresh `student_handbook` acceptance rerun confirmed the expanded `11`-case release gate on real providers.
- The rerun kept deterministic gating stable across all 3 runs, validated `procedure_directness` across the procedure questions, and closed all supplemental soft gates as `pass`.
- Phase 7 remains complete; the remaining follow-up outside this phase is only the first real deployed Worker observability verification.

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 03.1 → 03.2 → 4 → 04.1 → 04.2 → 04.3 → 04.4 → 04.5 → 04.6 → 04.7 → 5 → 05.1 → 6 → 7 → 8 → 9 → 09.1 → 10

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Contract And Boundary Guardrails | 2/2 | Complete   | 2026-03-23 |
| 2. Student Handbook Raw Ingestion | 2/2 | Complete | 2026-03-24 |
| 3. Retrieval Corpus Preparation | 2/2 | Complete | 2026-03-24 |
| 03.1. Availability Specialist 最小闭环 | 3/3 | Complete | 2026-03-25 |
| 03.2. Source Truth Fan-Out And Attachment Projection | 2/2 | Complete|  |
| 4. RAG Specialist Answer Path | 3/3 | Complete | 2026-03-27 |
| 04.1. Cloudflare Entry And Protected Internal Panel Design | 3/3 | Complete   | 2026-03-25 |
| 04.2. Cloudflare Runtime Topology And Delivery Shape | 2/2 | Complete   | 2026-03-25 |
| 04.3. Public Entry Edge Integration Contract | 2/2 | Complete   | 2026-03-25 |
| 04.4. Protected Internal Panel Runtime Shell | 2/2 | Complete   | 2026-03-25 |
| 04.5. Cloudflare Worker Consumer Entry And Access Policy | 2/2 | Complete   | 2026-03-25 |
| 04.6. Cloudflare Worker Runtime Implementation | 3/3 | Complete    | 2026-03-25 |
| 04.7. Public Consumer Chat App Design | 2/2 | Complete | 2026-03-27 |
| 5. Supervisor Entry, ACL, And Audit | 3/3 | Complete | 2026-03-27 |
| 05.1. Curriculum Chunking Boundary Freeze | 4/4 | Complete | 2026-03-27 |
| 6. Curriculum Offline Preparation | 2/2 | Complete | 2026-03-27 |
| 7. Verification And Release Gate | 2/2 | Complete | 2026-03-27 |
| 8. Student Handbook Ambiguous Policy Query Hardening | 4/4 | Complete | 2026-04-02 |
| 9. Curriculum Ambiguous Program Query Hardening | 0/0 | Not started |  |
| 09.1. Env Bootstrap And Provider Configuration Governance | 4/4 | Complete | 2026-04-02 |
| 10. Official Web Repo Hardening And Expansion | 0/0 | Not started |  |

### Phase 8: Student Handbook Ambiguous Policy Query Hardening

**Goal:** Harden `student_handbook` ambiguous policy questions so informal aliases, missing policy objects, and cross-policy lexical contamination no longer silently drag retrieval onto the wrong制度.
**Requirements**: []
**Depends on:** Phase 7
**Success Criteria** (what must be TRUE):
  1. `rag-specialist` can resolve handbook policy objects conservatively and clarify when the target制度 is still ambiguous.
  2. `retrieval-core` can restrict handbook retrieval to resolved target document IDs without weakening existing ACL/current/revision filters.
  3. Resolved-but-unsupported questions return object-scoped `no_answer` instead of silently borrowing rules from another制度.
  4. handbook evals and retrieval benchmarks permanently cover the ambiguous-policy regression cases.
  5. operator-facing request projection exposes summary diagnostics for clarification/no-answer/object targeting through `app-api` owned APIs.
**Plans:** 4/4 plans complete

Plans:
- [x] 08-01: Add retrieval-core document-targeted retrieval for resolved handbook policy objects.
- [x] 08-02: Add `rag-specialist` policy-object resolution, clarification, and object-scoped no-answer behavior.
- [x] 08-03: Extend handbook eval and retrieval benchmark coverage for ambiguous policy queries.
- [x] 08-04: Persist/request-display summary diagnostics and update architecture/planning truth after verification.

Verification note:

- local automated verification is green: `pnpm web:typecheck`, `pnpm web:test`, and `UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m unittest discover -s tests -t .`
- fresh handbook accept rerun now succeeds through the repo-shipped bootstrap path and produced `.tmp/evals/student-handbook-formal-benchmark-accept-20260402T182346`
- live acceptance is green again: `final_overall_verdict=pass`, deterministic lane is stably `11/11` across all 3 reruns, and repair stays skipped with `selected_targets=0`
- supplemental gate is also `pass`; key means are `judge.refusal_quality=0.9658`, `ragas.faithfulness=0.9241`, and `ragas.answer_relevancy=0.8652`
- phase 8 closeout is now validated and can be treated as completed truth using the `20260402T182346` artifact as the latest baseline

### Phase 9: Curriculum Ambiguous Program Query Hardening

**Goal:** Harden ambiguous `curriculum/curriculum_plan` queries that refer to short program fragments or family aliases so generic membership questions can return controlled family-aware answers, short doc-fragment/deictic queries still fail closed when unresolved, and personalization only acts as typed bias rather than silent hard resolution.
**Requirements**: [AORC-03]
**Depends on:** Phase 7
**Success Criteria** (what must be TRUE):
  1. `rag-specialist` owns a curriculum-specific resolve / bias / clarify planning lane that is separate from handbook policy-object logic.
  2. Curriculum alias handling is governed by repo-tracked tiered config (`safe alias`, `family alias`, `scoped alias`, `forbidden generic alias`) rather than a single global replacement table.
  3. `retrieval-core` can distinguish hard resolved document targeting from soft preferred-candidate bias without changing ACL/current/revision-serving semantics.
  4. Generic family aliases do not become canonical single-doc truth; membership questions can resolve to controlled family answers, while unresolved doc-fragment/deictic cases still fail closed into `needs_clarification`.
  5. Eval truth and workflow cases explicitly cover `profile memory` / `verified identity` assisted curriculum disambiguation without allowing memory-only silent collapse.
**Plans:** 3/3 plans complete

Plans:
- [x] 09-01: Freeze program-family collection truth, specialist planning lane, and retrieval filter seam.
- [x] 09-02: Externalize course/course-family alias governance and add high-frequency alias gates.
- [x] 09-03: Close deictic verified-identity truth, soft-personalization fast-fail, and diagnostics coverage.

### Phase 09.1: Env Bootstrap And Provider Configuration Governance (INSERTED)

**Goal:** Freeze and implement explicit env bootstrap, provider precedence, and fail-fast configuration diagnostics so repo-shipped entrypoints, eval/live benchmark lanes, and future deploy surfaces resolve credentials from one explicit contract instead of implicit shell state.
**Requirements**: []
**Depends on:** Phase 9
**Success Criteria** (what must be TRUE):
  1. Repo-shipped Python entrypoints bootstrap only explicit local env sources for the current worktree or current app and do not silently fall back to another worktree.
  2. Shared provider resolution is centralized, with one precedence contract for `EVAL_LLM_* > LLM_*` and `EVAL_EMBEDDING_* > EMBEDDING_*`.
  3. Missing-config failures can distinguish missing secret, missing bootstrap, and wrong owner/surface without printing secret values.
  4. Local `.env` convenience and deploy secret-store ownership are explicitly separated in docs and runtime expectations.
**Plans:** 4/4 plans complete

Plans:
- [x] 09.1-01: Freeze the shared bootstrap and provider-resolution foundation.
- [x] 09.1-02: Migrate eval settings and adapters to the shared provider contract.
- [x] 09.1-03: Align repo entrypoints and ship an env/provider doctor command.
- [x] 09.1-04: Close docs/examples and deploy-side provider secret governance.

### Phase 10: Official Web Repo Hardening And Expansion

**Goal:** [To be planned]
**Requirements**: TBD
**Depends on:** Phase 9
**Plans:** 0 plans

Plans:
- [ ] TBD (run /gsd:plan-phase 10 to break down)

Coordination note:

- `Phase 10` / `official-web` 当前由其他 worktree 处理。
- 除非该 worktree 显式回交，否则这里不要再把它重复当作当前执行项。

### Phase 11: Campus Identity, Authorization, Memory, And Restricted Document Foundation

**Goal:** Close the app-owned campus identity / authorization / memory foundation so restricted document rollout can proceed on a canonical principal and projection seam instead of the current transitional ACL carrier.
**Requirements**: []
**Depends on:** Phase 09.1
**Success Criteria** (what must be TRUE):
  1. `apps/app-api` can project canonical principal class, authorization projection source, entitlement snapshot marker, profile memory summary, and session summary without promoting raw auth input into downstream truth.
  2. `packages/contracts` plus the `app-api -> supervisor-api` seam preserve `principal_type` and authorization `projection_source` inside `ContextProjection`.
  3. restricted-document rollout has explicit follow-up execution waves for data-plane projection, retrieval fail-close behavior, personalization wiring, and compatibility cleanup.
  4. memory and personalization remain non-authorizing throughout the phase; they may bias planning or wording later, but may not widen retrieval visibility.
**Plans:** 5/5 plans complete

Plans:
- [x] 11-01: Freeze canonical principal taxonomy and projection metadata in `app-api` / shared contracts.
- [x] 11-02: Project restricted-document visibility and entitlement fields through ingestion/data plane.
- [x] 11-03: Enforce restricted-document fail-closed retrieval behavior and surface-safe deny semantics.
- [x] 11-04: Wire typed memory / personalization through supervisor and `rag-specialist` without granting permissions.
- [x] 11-05: Remove transitional ACL truth, expand eval coverage, and close telemetry / compatibility gates.

Verification note:

- `11-01` is now implemented and verified
- the shared seam explicitly carries `principal_type` and authorization `projection_source`
- targeted verification is green: `pnpm --filter app-api typecheck`, targeted `app-api` node tests, `UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m unittest tests.app_api.test_projection tests.contracts.test_models tests.api.test_supervisor_api`, and focused `git diff --check`
- `11-02` is now implemented and verified
- restricted-document registry / chunk / import metadata now treat `visibility_* + entitlement_*` as canonical truth and keep `acl_level / acl_groups / campus_scope` only as controlled mirrors
- targeted ingestion verification is green: `UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m unittest tests.ingestion.test_registry_models tests.ingestion.test_campusrag_ingestion_support tests.ingestion.test_processing_pipeline tests.ingestion.test_split_manifest tests.ingestion.test_provider_result_replay_rebuild`
- `11-05` is now implemented and verified
- `RetrievalRequest` no longer exposes top-level `acl_groups` / `campus_scope`, supervisor audit now persists only minimal authz/personalization summary, and eval validators now use canonical restricted vocabulary while rejecting program-family / soft-personalization single-doc truth collapse
- targeted cleanup verification is green: `UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m unittest tests.retrieval.test_backend_qdrant tests.retrieval.test_service tests.supervisor.test_supervisor_core tests.api.test_supervisor_api tests.evals.test_retrieval_benchmark`
- focused diff hygiene is green: `git diff --check -- packages/retrieval-core/src/campus_retrieval_core/models.py packages/supervisor-core/src/campus_supervisor_core/audit.py packages/evals/src/campus_evals/benchmark.py tests/retrieval/test_service.py tests/supervisor/test_supervisor_core.py tests/api/test_supervisor_api.py tests/evals/test_retrieval_benchmark.py`
- `11-04` is now implemented and verified
- supervisor scope clarification now has an explicit safe personalization seam, while `rag-specialist` only consumes user-visible profile memory plus confirmed session slots for clarification bias
- targeted supervisor/specialist verification is green: `UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m unittest tests.supervisor.test_supervisor_core tests.supervisor.test_supervisor_routing tests.supervisor.test_supervisor_policy tests.specialist.test_rag_specialist`
- `11-03` is now implemented and verified
- retrieval pre-filter now uses only canonical `visibility_level` / `entitlement_groups` / `visibility_scope`, and targeted restricted docs fail-close before candidate retrieval
- `rag-specialist` now maps targeted restricted deny to safe `no_answer` without leaking resolved policy title, snippet, citation, anchor, or retrieved-title summary
- targeted retrieval/specialist verification is green: `UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m unittest tests.retrieval.test_backend_qdrant tests.retrieval.test_service tests.specialist.test_rag_specialist`
