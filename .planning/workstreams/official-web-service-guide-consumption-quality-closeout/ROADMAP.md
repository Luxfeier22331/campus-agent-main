---
doc_type: roadmap
status: active
created: 2026-05-04
updated: 2026-05-04
---

<!-- markdownlint-disable MD013 -->

# Roadmap

| Phase | Status | Purpose |
| --- | --- | --- |
| Phase 0 | completed | Freeze scope, source facts and quality gaps |
| Phase 1 | completed | Update architecture and projection contract for grouped service-guide sections |
| Phase 2 | completed | Refactor official-web service-guide candidate extraction and declarative composition |
| Phase 3 | completed | Refactor selected-write release projection and typed read-model compatibility |
| Phase 4 | completed | Implement focused `service_guide_lookup` section selection and answer shaping |
| Phase 5 | completed | Add runtime guardrails and agent observability for service-guide answers |
| Phase 6 | completed | Add eval dataset and release-gate coverage for product questions |
| Phase 7 | completed | Run real source-pack no-promotion replay proof |
| Phase 8 | completed | Run isolated selected-write publish proof |
| Phase 9 | completed | Close out docs, evidence and workstream state |

## Phase 0: Scope And Gap Freeze

Status: completed.

Deliverables:

- Record current gaps from source-pack replay and runtime inspection.
- Confirm non-goals: no broad crawl, no transaction execution, no app-api selected-write ownership.
- Confirm best-practice anchor: structured outputs, guardrails, tracing and evals.

Acceptance:

- `README.md`, `REQUIREMENTS.md`, `ROADMAP.md`, `STATE.md` exist and agree on boundaries.
- `GAP-REVIEW.md` records the concrete review gaps and exit rules so follow-up work does not rely
  on chat history.
- Each planned implementation phase has a `PLAN.md` file under `phases/`.

## Phase 1: Architecture And Contract Update

Status: completed.

Purpose:

- Make the target shape explicit before changing code.

Implementation scope:

- Update `docs/architecture/domains/campus-services/architecture.md`.
- Update `docs/architecture/domains/official-web/architecture.md` if composition semantics change.
- Update service-guide projection contract docs or create a focused data contract doc if missing.
- Update `packages/contracts` service-guide dataclasses / shared literals before dependent code.
- Define canonical grouped procedure shape:
  - `procedure_groups`: stable group id, title, intent/focus tags, ordered steps, source refs
  - selected/omitted section metadata for focused runtime answers
  - compatibility mapping into existing `guide_sections`
  - field-level `source_refs` / `field_source_urls`
- Define cross-language golden fixture ownership for Python, Go and TypeScript surfaces.

Acceptance:

- Docs clearly distinguish source-truth, candidate, projection and runtime answer shapes.
- Docs state that grouped procedures are projection truth, not query-time raw parsing.
- Python, Go and TypeScript contract consumers have an agreed golden fixture or explicit
  non-consumer note.
- `provider_function_tools.v1.json` and eval denominator fixtures are checked for drift if the
  public tool schema changes.

## Phase 2: Official-Web Candidate Extraction And Composition

Status: completed.

Purpose:

- Move from ad hoc flat extraction toward source-faithful structured candidates.

Implementation scope:

- Add tests for real-like VPN direct/client/mobile grouped extraction.
- Add tests for email material noise filtering using real listing-like rows.
- Extract section headings and ordered steps into candidate `procedure_groups`.
- Keep fallback `process_steps` for compatibility.
- Normalize host-like entries without losing source label.
- Replace hard-coded composition branches with required role-driven composition metadata:
  `procedure_source`, `entry_source`, `material_source`, `contact_source`.
- Update `target-source-map.json` / source-pack composition schema and validators for required and
  optional roles.

Acceptance:

- VPN candidate has grouped procedures and no duplicate `vpn.muc.edu.cn` / `https://vpn.muc.edu.cn`
  entries.
- Email candidate does not treat shell row `申请表格` as a required material.
- Information disclosure and email composition still pass current replay tests.
- Invalid, missing or ambiguous composition roles fail closed before selected-write candidate
  publication.

## Phase 3: Selected-Write Release And Read-Model Compatibility

Status: completed.

Purpose:

- Publish grouped service-guide facts without breaking existing consumers.

Implementation scope:

- Extend `apps/ingestion-worker/src/campus_ingestion_worker/release_official_web_selected_write.py`.
- Preserve existing `guide_sections` and `entry_refs` behavior where consumers still expect it.
- Add grouped procedure data into projection records.
- Add typed PostgreSQL read-model migration / persistence / backfill or compatibility projection for
  grouped procedure fields.
- Define schema versioning and rollback behavior for mixed old/new records.
- Ensure `recordCount` remains task-scope and `fullRecordCount` remains full-impact.
- Ensure carry-forward uses canonical `official_web:<inventory>:<version>` refs only for
  replacement identity.

Acceptance:

- Current selected-write release tests pass.
- New release tests prove grouped procedure fields are published and source refs are field-specific.
- Current read-model consumers do not lose old section content during migration.
- Runtime query tests prove grouped procedure data is available through PostgreSQL typed read model,
  not only object projection artifacts.

## Phase 4: Runtime Focused Answer Shaping

Status: completed.

Purpose:

- Make `service_guide_lookup` answer the requested facet instead of dumping the whole guide.

Implementation scope:

- Extend query/result models if needed to carry selected sections and omitted-section metadata.
- Extend supervisor planner tests for focus routing before touching answer rendering.
- Add guide-focus routing for:
  - entry
  - procedure
  - required materials
  - contact
  - office hours
  - eligibility
- Implement section selection for grouped procedures.
- Keep fail-close behavior when the requested facet is missing.

Acceptance:

- `VPN入口在哪里` returns the entry URL and does not dump installation steps.
- `VPN客户端怎么安装` returns client-install steps and not unrelated direct/mobile steps.
- `邮箱申请需要什么表` returns material/form information and source.
- Planner cases prove `入口在哪里`, `怎么安装`, `需要什么表`, `电话是多少`, `办理时间` and
  `哪些人能办` map to the expected `guide_focus`.

## Phase 5: Runtime Guardrails And Observability

Status: completed.

Purpose:

- Prevent unsupported service-guide answers from passing through runtime.

Implementation scope:

- Add deterministic guardrail checks to `campus-services-agent` service-guide response path.
- Emit observability details for:
  - selected service
  - requested guide focus
  - selected section ids
  - missing requested fields
  - source refs used
  - guardrail result
- Ensure safe details do not expose raw source bundles or object locators.

Acceptance:

- Tests prove unsupported fields produce `temporarily_unverifiable` / `no_answer` semantics.
- Agent observability includes section selection and guardrail status.
- Guardrail tests prove unrelated selected sections are rejected before final answer rendering.

## Phase 6: Product Eval And Release Gate Coverage

Status: completed.

Purpose:

- Convert the intended user journeys into repeatable gates.

Implementation scope:

- Add service-guide official-web product-question eval cases.
- Extend `service_guide_lookup_release_gate` or add a focused companion gate.
- Assert answer focus, source URL presence, no fabricated fields, and no overlong section dump.
- Define deterministic thresholds:
  - max selected section count per focus
  - max answer character budget per focus
  - required tokens and forbidden unrelated tokens for each product question
  - source URL coverage and field-source coverage
- Include task-scope/full-impact selected-write semantics in gate artifacts.

Acceptance:

- At least six product questions listed in requirements have deterministic eval coverage.
- Gate fails if VPN entry query returns the full 17-step procedure dump.
- Gate fails if planner focus, runtime selected sections or source refs drift independently.

## Phase 7: Real Source-Pack No-Promotion Replay

Status: completed.

Purpose:

- Prove candidate, projection and runtime-preview quality on real captured official-web source packs
  without broad crawling or current-truth writes.

Implementation scope:

- Re-run no-promotion replay on the current official-web source pack.
- Generate machine-readable quality summary:
  - service name
  - procedure group count
  - step count by group
  - material noise count
  - entry URL coverage
  - source ref coverage
  - guardrail/eval result
- Run selected-write preview for impacted service-guide targets only.

Acceptance:

- Real replay evidence demonstrates VPN, campus network, email, information disclosure and campus
  card do not regress.
- No PG/object-store current promotion occurs in this phase.
- Preview report includes exact write plan, blocked/deferred reasons and source refs for every ready
  candidate.

## Phase 8: Isolated Selected-Write Publish Proof

Status: completed.

Purpose:

- Prove selected-write publish behavior only after no-promotion evidence is clean, using an explicit
  isolated local target environment.

Implementation scope:

- Declare accepted local target environment before running publish:
  - PostgreSQL database/schema or test container identity
  - object-store endpoint/bucket/prefix
  - cleanup/rollback command
  - impacted selected-write target list
- Run selected-write release for impacted service-guide targets only.
- Verify release catalog, `structured_projection_current`, typed read model and operator-safe
  projection snapshots.
- Run runtime preview/eval against the published local current truth.
- Clean up or record retained local artifacts according to the declared local target policy.

Acceptance:

- Publish proof is isolated from developer default PG/object-store state.
- Release task scope and full-impact counts match the Phase 7 preview.
- Runtime reads grouped procedure fields from typed read model after publish.
- Cleanup or retention evidence is recorded.

## Phase 9: Closeout

Status: completed.

Purpose:

- Make the workstream handoff clean and non-ambiguous.

Implementation scope:

- Update `STATE.md`.
- Add closeout summary with verification commands and artifact paths.
- Update `.planning/WORKSTREAMS.md` current slice / status.
- Record remaining deferred gaps only if they are outside this workstream's scope.

Acceptance:

- Workstream can be resumed or completed without relying on chat history.
