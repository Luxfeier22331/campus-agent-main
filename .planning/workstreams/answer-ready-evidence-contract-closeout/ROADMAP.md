---
doc_type: roadmap
status: completed
created: 2026-05-06
updated: 2026-05-07
---

<!-- markdownlint-disable MD013 -->

# Roadmap: Answer-Ready Evidence Contract Closeout

## Phase Status

- [x] **Phase 0: Contract Inventory And Boundary Freeze** — inventory current metadata production,
  projection, ranking consumption and eval gaps; freeze exact public/internal contract split.
- [x] **Phase 1: Evidence Contract And Payload Schema** — implement retrieval-internal typed
  evidence projection/accessor first; defer public `EvidenceSource` expansion unless a minimal scalar
  field is proven necessary.
- [x] **Phase 2: Ingestion Semantic Extraction And Chunk Units** — emit stable answer-ready fields
  for procedure, eligibility, condition, exclusion, category overview and parent-child clause units.
- [x] **Phase 3: Retrieval Ranking, Selection And Replan Consumption** — consume typed metadata in
  ranking/selection/replan before text-cue fallback.
- [x] **Phase 4: Typed Answer Drafts And Grounding** — introduce typed answer drafts for policy list,
  procedure, eligibility judgment and condition-table answers, then render grounded Chinese answers.
- [x] **Phase 5: Component Eval And Release Gates** — add stage-local assertions, qrels expectations
  and chunk/release quality fail-close gates.
- [x] **Phase 6: Backfill, Migration And Closeout** — rebuild/backfill admitted `student_rules`
  chunks, prove compatibility, update docs/planning and close reopen rules.

## Phase 0: Contract Inventory And Boundary Freeze

**Goal:** avoid designing from memory; establish the exact contract debt, freeze what belongs in
public `EvidenceSource` versus retrieval-internal typed attributes, and name the release gate path
that will fail closed when rebuilt query-serving chunks lack the contract.

**Scope:**

- Inventory current fields emitted by:
  - `packages/ingestion-core/src/campus_ingestion_core/regulation_answer_roles.py`
  - `packages/ingestion-core/src/campus_ingestion_core/handbook_semantics.py`
  - `packages/ingestion-core/src/campus_ingestion_core/regulation_chunking.py`
  - `packages/ingestion-core/src/campus_ingestion_core/process_candidate_postprocess.py`
- Inventory Qdrant payload projection:
  - `packages/retrieval-core/src/campus_retrieval_core/backend_qdrant_source_metadata.py`
  - `packages/retrieval-core/src/campus_retrieval_core/backend_qdrant_evidence.py`
- Inventory runtime consumers:
  - `evidence_semantics.py`
  - `evidence_ranking_features.py`
  - `agent_selection_rows.py`
  - `agent_answer_shape.py`
- Inventory eval gates:
  - `packages/evals/src/campus_evals/retrieval_chunk_quality.py`
  - relevant `tests/evals/*` and `tests/agent/*`.
- Freeze component eval contract early:
  - regression sample matrix
  - stage failure taxonomy
  - expected intent / evidence role / draft kind fields.
- Freeze taxonomy governance:
  - answer role vocabulary
  - condition subject vocabulary
  - unknown / generic / other handling
  - taxonomy versioning and no one-off subject rule.
- Freeze parent unit id rule:
  - id source and stability contract
  - edition/version participation
  - article/clause/list/table/category overview encoding
  - qrels/citation compatibility posture.
- Decide exact field split:
  - public retrieval projection fields
  - Qdrant payload/index fields
  - package-local typed extraction structures
  - answer draft structures.
- Decide fallback deprecation policy:
  - when text-cue fallback is allowed
  - how fallback usage is reported
  - which rebuilt `student_rules` cases must fail if typed metadata is missing.
- Decide release gate integration:
  - exact existing release-admission module or command to extend
  - required fixture/manifest evidence
  - expected fail-close test location.

**Exit Criteria:**

- A field matrix exists in Phase 0 summary.
- `CONTRACT-DECISION.md` defines one mandatory online projection path for every success-criteria
  field, even when that path remains retrieval-internal rather than public `EvidenceSource`.
- `FALLBACK-DEPRECATION.md` defines fallback budget, diagnostics and disallowed rebuilt-index cases.
- `RELEASE-GATE-DECISION.md` identifies the concrete release-admission hook and test owner.
- `EVAL-CONTRACT.md` defines the stage-local eval schema before implementation starts.
- `TAXONOMY-GOVERNANCE.md` defines controlled vocabularies and versioning.
- `PARENT-UNIT-ID.md` defines stable parent id derivation and migration posture.
- No phase depends on leaking backend/vendor fields into `packages/contracts`.
- Implementation blockers are separated from backfill/rebuild blockers.

## Phase 1: Evidence Contract And Payload Schema

**Goal:** define the typed contract before modifying ingestion behavior broadly.

**Scope:**

- Keep public `EvidenceSource` unchanged by default. Public scalar promotion is allowed only if
  Phase 1 proves a concrete cross-package consumer need and records the justification.
- Implement the retrieval-internal typed evidence projection/accessor approved in Phase 0 for:
  - `answer_role`
  - `condition_subject`
  - `parent_unit_id`
  - `evidence_contract_version`
- Add retrieval-internal typed attributes for richer structures:
  - procedure step attributes
  - category overview attributes
  - condition group attributes
  - parent article / clause context.
- Add payload metadata constants or schema helpers so ingestion and retrieval agree on names.
- Add tests for:
  - retrieval-internal accessor defaults/backwards compatibility
  - Qdrant metadata resolver support
  - payload field normalization
  - unknown-field safety.
  - public contract guardrails proving no broad `EvidenceSource` expansion.

**Exit Criteria:**

- Existing retrieval tests pass without requiring rebuild.
- New fields can be present or absent without breaking old indexes.
- New fields are read from payload into the typed evidence accessor where available.
- Ranking/selection input has a single documented accessor for the approved internal projection
  fields.

## Phase 2: Ingestion Semantic Extraction And Chunk Units

**Goal:** make metadata originate from ingestion/chunking rather than runtime string cues.

**Scope:**

- Extend answer-role metadata generation for:
  - typed procedure steps
  - eligibility intros and condition groups
  - condition subjects such as rank threshold, paper/publication, material, deadline, audience,
    discipline relief condition
  - exclusion/exception polarity and action type
  - category overview registry metadata
- Govern answer roles and condition subjects through Phase 0 `TAXONOMY-GOVERNANCE.md`; no new
  one-off values are admitted without ingestion, retrieval and component-eval tests.
- Improve clause-level / parent-child chunking:
  - preserve parent article context
  - assign stable parent unit ids
  - follow the Phase 0 `PARENT-UNIT-ID.md` derivation rule
  - avoid mixing intro/procedure/condition/example/list in a single answer-ready chunk when it
    prevents direct answering
  - keep table facts answer-ready.
- Run a small real-document dry run before full backfill:
  - national scholarship rank threshold and paper condition
  - discipline relief procedure and exclusion
  - scholarship category overview
  - student card reissue procedure
  - table fact evidence.
- Add ingestion tests for real student-rules examples:
  - national scholarship rank threshold and paper condition
  - discipline relief procedure and exclusion
  - scholarship category overview
  - student card reissue procedure.

**Exit Criteria:**

- Chunk metadata contains typed fields before indexing.
- No new answer-ready chunk relies solely on runtime snippet cue detection.
- Chunk quality gate can distinguish missing contract fields from low-signal content.
- Small real-document dry run proves the extraction contract before Phase 6 rebuild/backfill.

## Phase 3: Retrieval Ranking, Selection And Replan Consumption

**Goal:** use the new evidence contract in online retrieval decisions.

**Scope:**

- Update ranking feature extraction to prefer typed fields:
  - intent `procedure` targets `answer_role=procedure_step`
  - negative restriction targets `answer_role=exclusion_rule | exception_rule`
  - category discovery targets `answer_role=category_overview | policy_list`
  - judgment queries target matching `condition_subject`.
- Enforce Phase 0 fallback policy:
  - old-index compatibility may use fallback with diagnostics
  - rebuilt `student_rules` answer-ready chunks covered by the contract must prefer typed metadata
  - tests must fail if fallback becomes the primary path for target rebuilt cases.
- Update supporting evidence selection to reject non-answer-ready intro/procedure/ratio chunks when
  typed alternatives exist.
- Update replan triggers for:
  - missing answer role
  - polarity mismatch
  - condition subject mismatch
  - category coverage missing
  - duplicate parent-unit over-selection.
- Add deterministic tests for ranking/selection and retrieval execution.

**Exit Criteria:**

- The target regression cases pass through ranking and selection with typed metadata.
- Fallback cue paths are observable and covered by tests with required diagnostics:
  `fallback_used`, `fallback_reason`, `missing_contract_fields`,
  `source_index_contract_version` and `fallback_primary_signal`.
- Rebuilt target `student_rules` cases have `0` primary text-cue fallback budget.
- Replan does not widen scope, authz, version or serving surface.

## Phase 4: Typed Answer Drafts And Grounding

**Goal:** stop forcing every answer shape through free-form natural language before grounding.

**Scope:**

- Add typed answer draft models in `rag-agent`:
  - `policy_list`
  - `procedure_steps`
  - `eligibility_judgment`
  - `condition_table`
  - `unsupported`
  - `clarification`
- Map evidence roles to draft shapes:
  - category overview -> policy list
  - procedure step -> procedure steps
  - condition/exclusion/exception -> eligibility judgment or condition table.
- Render final Chinese answer from typed draft.
- Ground typed draft items to evidence source ids and excerpts before final render.
- Freeze typed draft relationship to existing claim/evidence graph:
  - typed draft is the upstream structured answer representation
  - claim/list/step support is projected into the existing claim evidence graph
  - no second grounding truth may bypass the claim/evidence graph.
- Ensure Agents SDK output path cannot bypass draft/evidence support requirements.
  - This is limited to validating existing SDK/deterministic output adapters against typed drafts.
  - Do not reopen SDK loop ownership, SDK tool schemas, handoff routing or public ToolSpec.

**Exit Criteria:**

- Typed drafts are validated before rendering.
- Answers retain existing public `AgentResponse` shape.
- Claim/list item support is checked before completed status.
- Existing claim/evidence graph remains the single grounding diagnostics surface.

## Phase 5: Component Eval And Release Gates

**Goal:** make failures attributable and prevent release of non-answer-ready chunks.

**Scope:**

- Implement the Phase 0 frozen component eval contract from `EVAL-CONTRACT.md`:
  - failure classes: `intent_mismatch`, `retrieval_miss`, `ranking_mismatch`,
    `selection_not_answer_ready`, `draft_contract_mismatch`, `grounding_mismatch`,
    `chunk_contract_missing`
  - expected intent / polarity / answer role / condition subject / document or category coverage /
    draft kind / grounding fields.
- Add component-level eval assertions:
  - intent classification
  - retrieval target / top-k / coverage
  - ranking top source
  - supporting evidence answer-readiness
  - typed draft contract
  - grounding support.
- Extend chunk quality gate:
  - required answer role fields
  - required condition subject for judgment cases
  - procedure typed fields for procedure chunks
  - category overview member metadata
  - parent context integrity.
- Extend qrels or fixture metadata to assert expected answer roles and condition subjects.
- Add release-admission fail-close tests for query-enabled `student_rules`.
  - The gate must be wired into the Phase 0 chosen hook
    `registry_scope_release.publish_scope_release -> evaluate_release_chunk_quality`, not an
    optional standalone eval.
  - `regulation_rag_release_admission` must record and validate answer-ready gate status.

**Exit Criteria:**

- A failing sample identifies which stage failed.
- Release gate fails if answer-ready fields are absent from required chunks.
- The release-admission test proves the same path that can publish/switch `student_rules` cannot pass
  when answer-ready contract fields are absent.
- RAGAS remains diagnostic, not the only owner of quality attribution.

## Phase 6: Backfill, Migration And Closeout

**Goal:** apply the contract to admitted student-rules truth without breaking current serving.

**Scope:**

- Rebuild `student_rules` chunks with new metadata.
- Run chunk quality gate and targeted real-sample review.
- Run retrieval/e2e regression on accepted fuzzy and formal samples.
- Plan institutional-rules adoption if compatible. Mandatory closeout requires an adoption decision or
  follow-up seed; full institutional backfill does not block unless Phase 0 explicitly promotes it to
  scope.
- Update architecture/policy docs:
  - `student-handbook-chunking-and-validation-policy.md`
  - `retrieval-serving-architecture.md`
  - `agentic-retrieval-architecture.md` if target truth changes.
- Update workstream `STATE.md`, `WORKSTREAMS.md` and closeout/reopen rule.

**Exit Criteria:**

- New metadata is present in rebuilt chunks and runtime evidence projection.
- Targeted E2E samples pass with stage-local diagnostics available.
- Rebuilt target samples prove typed evidence metadata, not text cues, is the primary
  ranking/selection signal.
- Old indexes remain backward compatible or migration posture is explicit.
- Workstream has closeout evidence and remaining risks.
