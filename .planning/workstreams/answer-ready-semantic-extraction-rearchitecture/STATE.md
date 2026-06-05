---
doc_type: state
status: completed
created: 2026-05-07
updated: 2026-05-10
---

<!-- markdownlint-disable MD013 -->

# State: Answer-Ready Semantic Extraction Rearchitecture

## Current Position

**Status:** completed
**Current Phase:** completed
**Last Activity:** 2026-05-09
**Last Activity Description:** final workstream review repaired the `regulation_chunk_precision`
regression, hardened release-admission manifest immutability and chronology audit, extended
post-publish audit to validate both flat and runtime-effective sampled metadata, restored the
`campus-services-agent` deterministic structured handoff path when the native SDK runtime is
unavailable, reran focused and broad verification, and marked planning truth completed.

## Current Slice

All planned phases are complete. There is no remaining active implementation slice. Phase 11 now
owns the final audited closeout result, and the workstream is complete. The final closeout review recorded:

- keep planning truth aligned with verified evidence only:
  - Phase 2 summary now maps shared taxonomy/registry owners to ingestion and category-discovery
    consumption evidence
  - Phase 3 summary now maps clause parent-child deliverables to handbook, institutional,
    retrieval-projection and chunk-quality tests
  - Phase 4 summary now maps typed extraction deliverables to ingestion, oracle/runtime and
    validation evidence
  - Phase 5 summary now maps static chunk/release gate correctness to contract and release-admission
    tests
  - Phase 6 summary now maps typed ranking/selection/replan and legacy fallback quarantine to
    retrieval-core tests
  - Phase 7 summary now maps clarification / unsupported / grounded fail-close / SDK-path
    requirements to agent and eval suites
  - Phase 8 summary now maps stage-attribution and release attachment behavior to deterministic
    component eval and runtime observation suites
- `regulation_chunk_precision` regression is fixed:
  - `_build_answer_ready_regulation_segments()` now passes the first item block text into
    `_first_item_line_index(...)`
  - verification:
    - `uv run --all-packages python -m unittest tests.ingestion.test_regulation_chunk_precision -q`
      passed (`Ran 3 tests`, `OK`)
- post-publish audit no longer has the previously open semantic blind spot:
  - sampled published target-v3 answer-ready payloads are now revalidated with the shared contract
  - sampled published target-v3 payloads now fail when unresolved fallback provenance leaks into
    `condition_subject_provenance` or `procedure_action_provenance`
  - sampled published payload audit now also fails when flat payload projection and runtime
    `_node_content` projection drift on `answer_role` or `evidence_contract_version`
  - repaired verification evidence:
    - `uv run --all-packages python -m unittest tests.ingestion.test_registry_scope_release.RegistryScopeReleaseTest.test_post_publish_audit_fails_when_sampled_payload_keeps_target_v3_fallback_provenance tests.ingestion.test_registry_scope_release.RegistryScopeReleaseTest.test_post_publish_audit_fails_when_sampled_payload_keeps_target_v3_fallback_procedure_provenance -q`
      passed
    - `uv run --all-packages python -m unittest tests.ingestion.test_registry_scope_release.RegistryScopeReleaseTest.test_post_publish_audit_fails_when_only_runtime_node_metadata_marks_target_v3_contract tests.ingestion.test_registry_scope_release.RegistryScopeReleaseTest.test_post_publish_audit_fails_when_only_runtime_node_metadata_keeps_fallback_provenance tests.ingestion.test_registry_scope_release.RegistryScopeReleaseTest.test_post_publish_audit_fails_when_payload_projection_drops_target_markers -q`
      passed (`Ran 3 tests`, `OK`)
    - `uv run --all-packages python -m unittest tests.ingestion.test_registry_scope_release -q`
      passed (`Ran 21 tests`, `OK`)
    - `uv run --all-packages ruff check packages/ingestion-core/src/campus_ingestion_core/registry_scope_release.py tests/ingestion/test_registry_scope_release.py`
      passed
    - `uv run --all-packages ruff format packages/ingestion-core/src/campus_ingestion_core/registry_scope_release.py tests/ingestion/test_registry_scope_release.py --check`
      passed
- final workstream-focused verification is green:
  - `uv run --all-packages python -m unittest tests.agent.rag_agent_retrieval_intent_planning_suite tests.agent.rag_agent_institutional_rules_consumption_suite tests.evals.regulation_answer_ready_component_live_runner_suite tests.ingestion.test_registry_scope_release tests.retrieval.evidence_contract_ranking_suite tests.evals.answer_ready_component_eval_suite tests.ingestion.test_regulation_chunk_precision -q`
    passed (`Ran 85 tests`, `OK`)
  - `uv run --all-packages python -m unittest tests.ingestion.test_regulation_rag_release_manifest_audit tests.ingestion.test_index_release_acceptance -q`
    passed (`Ran 51 tests`, `OK`)
- fresh repo-owned verification baseline was rerun after the latest in-scope fixes:
  - `uv run --all-packages python -m unittest discover -s tests -t .`: passed
  - `pnpm docs:lint`: passed (`Summary: 0 error(s)`)
  - `pnpm yaml:lint`: passed
    (`Validated 22 YAML files from current worktree outside .planning/.`)
  - `uv run --all-packages ruff check .`: passed (`All checks passed!`)
  - `uv run --all-packages ruff format . --check`: failed
    (`230 files would be reformatted, 1858 files already formatted`)
  - `pnpm decomposition:lint`: passed
    (`Validated tracked decomposition budget for 3105 handwritten code/test files against configs/lint/decomposition-baseline.json at threshold 800.`)
  - all functional broad-verification regressions are clear.
  - restored in-scope broad verification:
    - `tests.api.supervisor_api_bridge_services_suite.*` no longer fails after
      `campus-services-agent` regains deterministic structured execution when `runtime=None`
      but the internal query service is configured
    - verification:
      - `uv run --all-packages python -m unittest tests.supervisor.admitted_agent_execution_suite -q`
        passed (`Ran 4 tests`, `OK`)
      - `uv run --all-packages python -m unittest tests.api.test_supervisor_api tests.ingestion.test_index_release_acceptance -q`
        passed (`Ran 88 tests`, `OK`)
      - `uv run --all-packages python -m unittest tests.api.supervisor_api_bridge_services_suite tests.supervisor.tool_execution_registry_suite tests.agent.test_notice_runtime_wiring tests.supervisor.agents_sdk_closeout_guardrails_suite -q`
        passed (`Ran 23 tests`, `OK`)
  - removed in-scope failure:
    `tests.ingestion.test_official_web_regulation_materialization.OfficialWebRegulationMaterializationTest.test_materialization_preserves_regulation_preface_and_drops_inline_link_child_duplicate`
  - the fix reused pre-body heading classification for
    `regulation_body_text_for_materialization(...)`, so typed candidate `regulation_lines` can
    still preserve wrapper heading evidence for quality/audit paths while canonical body and
    document units no longer retain the wrapper text as answer-bearing content
- latest related verification evidence:
  - `uv run --all-packages python -m unittest tests.ingestion.test_official_web_regulation_materialization.OfficialWebRegulationMaterializationTest.test_materialization_preserves_regulation_preface_and_drops_inline_link_child_duplicate -v`
    passed
  - `uv run --all-packages python -m unittest tests.ingestion.test_official_web_regulation_quality_audit tests.ingestion.official_web_projection_source_pack_regulation_suite tests.ingestion.test_official_web_regulation_materialization -q`
    passed (`Ran 24 tests`, `OK`, `skipped=1`)
- the last workstream-owned repo-wide `ruff` findings found during re-review are now fixed:
  - `packages/shared/src/campus_shared/regulation_semantic_registry.py` no longer carries the five
    `SIM102` / `SIM103` branches flagged in the fresh repo-wide run
  - `tests/agent/rag_agent_institutional_rules_consumption_suite.py` and
    `tests/evals/regulation_answer_ready_component_live_runner_suite.py` now satisfy import-order
    checks
  - repaired verification evidence:
    - targeted `ruff check` across the answer-ready semantic extraction file set: passed
      (`All checks passed!`)
    - `uv run --all-packages python -m unittest tests.shared.test_regulation_semantic_registry tests.shared.test_answer_ready_evidence_contract tests.agent.rag_agent_institutional_rules_consumption_suite tests.evals.regulation_answer_ready_component_live_runner_suite -q`
      passed (`Ran 206 tests`, `OK`)
- the in-scope completion-audit ingestion regressions found during broad verification are now
  fixed:
  - short-text merge keeps using typed semantics, but merge-time atomic blocking is now scoped to
    truly atomic roles such as `procedure_step` / `exclusion_rule` / `exception_rule` /
    `material_requirement` / `time_constraint`, instead of treating generic
    `eligibility_condition` clauses as unmergeable
  - handbook semantic release metadata now preserves explicit `regulation_body` /
    `scoped_rule_body` roles when no finer shared body-role classification is derivable, so
    downstream institutional/internal-notice chunk-quality gates can still inspect polluted body
    `section_path` / HTML leakage correctly
  - repaired verification evidence:
    - 6 narrow regression tests: passed
    - 101 neighboring ingestion tests across merge / handbook / institutional-regulation prep
      suites: passed
- no remaining broad-verification regression is attributed to this workstream.
- `student_rules` now has real release-lane serving proof plus explicit closeout audit counts:
  - release id: `r20260507_154528_764347_1005cea7`
  - alias target: `student_rules__r20260507_154528_764347_1005cea7`
  - release admission status: `passed`
  - retrieval acceptance status: `passed`
  - component eval status: `passed`
  - post-publish audit status: `passed`
  - fallback primary signal count: `0`
  - semantic oracle pass count: `9`
  - semantic oracle fail count: `0`
  - runtime readiness status: `ready`
  - release/admission manifest field audit status: `passed`

- `institutional_rules` now has real release-lane serving proof instead of compatibility-only or
  abstract release claims:
  - release id: `r20260509_071445_145990_6a88f8b8`
  - alias target: `institutional_rules__r20260509_071445_145990_6a88f8b8`
  - release admission status: `passed`
  - retrieval acceptance status: `passed`
  - component eval status: `passed`
  - post-publish audit status: `passed`
  - fallback primary signal count: `0`
  - semantic oracle pass count: `5`
  - semantic oracle fail count: `0`
  - runtime readiness status: `ready`
  - release/admission manifest field audit status: `passed`
- the query-serving release metadata guard now passes for the current `institutional_rules` alias;
  older published institutional releases missing `component_eval_status` no longer define serving
  truth
- Phase 10 also produced operator evidence that remote Qdrant cluster space pressure can block
  payload metadata refresh even after indexing succeeds, and that repo-governed preview GC is the
  correct recovery path under fail-closed release policy
- release-proof debt is closed:
  - explicit target-vs-legacy runtime branch isolation is implemented
  - closeout evidence is aligned; registry state intentionally remains `active` until explicit
    closure

- shared registry/taxonomy owner is established under `packages/shared`
- shared regulation body-role owner is now materially closed:
  - `handbook_semantics.py` no longer owns local `_is_scope_rule` / `_is_time_rule` /
    `_is_deadline_rule` / `_is_eligibility_rule` / `_is_definition_rule` /
    `_is_procedure_rule` / `_is_requirement_rule` helpers for common regulation-body
    classification
  - common regulation body `content_role` classification now resolves through
    `packages/shared/src/campus_shared/regulation_semantic_patterns.py`
  - shared body-role coverage is now frozen by direct tests for `scope_rule`, `time_rule`,
    `deadline`, `eligibility`, `definition`, `procedure`, and `requirement`
  - merge-time atomic answer-role detection now protects standalone negative policy clauses without
    writing parser-only fallback into final answer-ready metadata
- retrieval post-selection self-check now uses typed metadata before fallback when grounding is
  empty or semantically weak:
  - group-aligned `example_evidence` rows that only match through `condition_group_subject` now
    surface `group_support_missing` instead of collapsing into generic `focus_mismatch`
  - procedure-style queries that retrieve only same-group non-procedure child rows now surface
    `procedure_group_answer_role_mismatch`
  - condition/judgment-style queries that retrieve only same-group procedure-style rows now surface
    `condition_group_answer_role_mismatch`
- semantic replan now preserves retrieval failure-kind provenance instead of collapsing all typed
  misses back into `empty_supporting_evidence`
- semantic replan query rewriting now consumes typed `condition_subject` /
  `condition_group_subject` hints for group-missing condition queries, so rank-threshold misses can
  narrow toward threshold/exception clauses without introducing a new runtime Chinese-cue patch
- retrieval-side legacy-signal diagnostics are now contract-aware rather than base-field-aware:
  - v3 sidecars that carry `answer_role` / `parent_unit_id` / version only but omit required
    role-specific fields now surface legacy diagnostic labels such as `fallback_used=True`,
    `fallback_reason=missing_contract` and the missing typed field list, instead of being treated
    as complete typed evidence
  - canonical `condition_group_id` suffix recovery remains available for compatibility reads, so
    missing explicit `condition_group_subject` on old indexes can still be normalized without
    reopening text-cue fallback
  - target-v3 legacy-fallback quarantine now skips non-answer-bearing weak hits, so title/navigation
    probes degrade back to `no_answer` evidence handling instead of being promoted into
    retrieval-layer hard errors
- `student_rules` specific-policy focused retrieval plans now keep their two-step
  `policy-broad-lookup -> policy-focused-lookup` shape while allowing one bounded semantic replan;
  category-discovery plans remain `max_replans=0`
- `student_rules` discovery/category registry no longer lives canonically in `ingestion-core`
- multi-category overview emission works for documents like
  `handbook:e90f9707387f9e232ea88ce1c7f5328242e52389`
- shared semantic resolution now canonicalizes explicit legacy aliases such as
  `general_eligibility -> generic_condition`
- shared `condition_subject` resolution is now also moving off long inline keyword chains:
  broad amount/rank/paper/material/deadline/audience/example-domain matches now flow through
  shared keyword-rule tables instead of only resolver-local `if` ordering
- shared `condition_subject` keyword priority is now narrower and more stable for competition-like
  evidence: `体育比赛` / `体育竞赛` and `文艺比赛` are resolved before the broader
  `论文/发表/专利/竞赛` bucket, so sports and arts evidence no longer degrade into the generic
  `paper_or_publication` subject just because the text also contains `竞赛`
- shared `action_type` resolution is now also partially declaration-driven:
  text/context/section-path matches for `lift_discipline` and `reissue` now flow through shared
  rule tables instead of local marker tuples inside the resolver, while document-title
  cross-signal branches remain explicit
- procedure-step contract production now honors metadata-first action assignment before text-cue
  fallback
- procedure actor semantics are now partially closed at the shared contract layer:
  - shared registry now owns the controlled `procedure_actor` vocabulary plus alias
    canonicalization
  - shared v3 validation and release chunk quality now fail closed on unknown
    `procedure_actor` / `procedure_next_actor` values instead of silently passing ad hoc actor
    strings into target v3 releases
  - ingestion procedure-step contract production now resolves both explicit and inferred
    `procedure_actor` / `procedure_next_actor` values through the shared owner instead of keeping
    actor parsing in a local `ingestion-core` helper
  - actor / next-actor ownership is now also declaration-driven inside the shared registry:
    reusable shared keyword-rule tables now control actor and next-actor priority instead of a
    long resolver-local `if` chain, which removed the concrete false-positive path where
    `学生处` / `教务处` procedure clauses were downgraded to the generic `student` actor
  - shared actor resolution now also applies a lightweight actor-plus-action context pass before
    generic keyword fallback, so mixed clauses such as `学院审核学生提交的申请材料` and
    `指导教师审核学生提交的项目申请材料` resolve the real executing actor instead of promoting the
    student object mention
  - shared `procedure_action` resolution is now moving through the same owner cleanup:
    review/signoff/process/apply/submit behaviors are now declared through shared rule tables
    instead of one long inline branch chain, and actor-aware review resolution now beats
    `学生提交材料` object subclauses in mixed sentences such as
    `学院审核学生提交的申请材料` / `学生处审核学生提交的申请材料`
  - the shared process fallback is now narrowed so `处理决定` / `处理意见` / `处理结果` no longer
    promote deadline clauses into `procedure_step`, while genuine office process clauses like
    `统一受理、协调处理、统一答复...` keep the existing `keyword:处理` provenance contract
  - section-path subject hints now also consume a shared rule table for material/deadline routing
    before procedure/audience-specific branches
  - shared registry now also owns `intro_scope` resolution itself, not only list/group-intro cue
    detection: target-role driven `material_list` / `time_list` / `procedure_list` /
    `eligibility_group` assignment is now shared between ingestion contract production and shared
    answer-ready validation, eliminating the previous duplicated role-to-scope rule chain
  - shared registry now also owns intro target-role to intro-subject normalization for the typed
    intro contract: single-role intros such as `material_requirement` / `time_constraint` /
    `procedure_step` now resolve their expected intro subject through the same shared owner, while
    mixed-role intros such as `exception_rule + example_evidence` or
    `eligibility_condition + procedure_step` intentionally keep the existing grouped fallback
    subject instead of being reinterpreted as a child role subject inside validation
  - shared registry now also owns answer-role/table-type to expected `condition_polarity`
    normalization, so ingestion default polarity production and shared answer-ready validation no
    longer maintain separate positive/negative/neutral role matrices for the same regulation
    contract
  - shared registry now also owns controlled `procedure_materials` extraction for the current
    procedure-step contract vocabulary, so `书面申请` / `补办申请表` / `解除处分申请表` no longer come
    from a second private marker list inside `regulation_evidence_contract.py`
  - shared registry now also owns `condition_group_subject` resolution and canonical
    `condition_group_id` assembly:
    - ingestion `infer_condition_group_id(...)` and shared v3 validation no longer keep separate
      expected-subject/group-id rules for grouped clauses
    - `table_fact` grouped rows now resolve `deadline` / `material_requirement` / `amount_or_quota`
      through the same shared owner used by validation
    - explicit `condition_group_subject` still wins for grouped children whose chunk-local
      `condition_subject` intentionally differs from the parent group subject
  - chunk preparation now materializes per-chunk contract validation evidence instead of leaving
    validation only to tests/release gates:
    - prepared chunk metadata now carries
      `answer_ready_contract_validation_status`,
      `answer_ready_contract_validation_severity`,
      `answer_ready_contract_validation_version`,
      `answer_ready_contract_validation_issues`,
      `answer_ready_contract_required_fields`
    - the same shared validation wrapper is now reused by chunk preparation and release chunk
      quality, so Phase 4 no longer relies on release-admission-only evidence to prove contract
      correctness was evaluated
- retrieval chunk quality gate now treats missing `procedure_action_provenance` as part of grouped
  procedure contract failure reporting
- answer-ready evidence now carries `clause_unit_id` when a stable child-clause identity can be
  derived, and retrieval internal attributes preserve it
- shared v3 validation now fails clause-labeled answer-ready chunks that still lack
  `clause_unit_id`
- repeated eligibility-group intros under the same parent article now produce distinct stable
  `condition_group_id` values such as `article-020:group-01:rank_threshold` and
  `article-020:group-02:rank_threshold`
  - grouped answer-ready segment metadata now materializes final `condition_group_id` /
    `introduced_condition_group_id` directly from chunking-time group anchors instead of only
    passing `condition_group_key` / `introduced_condition_group_key` forward for the contract
    builder to stitch later
  - repeated material/time intro chunks now also preserve the matching logical intro-group anchor
    instead of always falling back to `introduced_condition_group_id=...:group-01:...`; repeated
    `申请材料如下` / `补充材料如下` and `申诉期限如下` / `补充期限如下` intros now point at the same
    numbered group as their child answer-ready evidence
  - repeated material/time intro anchor preservation is now guarded twice:
    - intro contract production no longer overwrites a chunking-time logical intro group with a
      fallback unkeyed subject group
    - intro group-anchor inference now applies the same scoped child-role hint used by final child
      segmentation, so later material/time groups no longer degrade to `supporting_detail` and
      silently lose their `group-02` anchor
  - repeated inline-example clauses under repeated `符合下列条件之一` scopes now also preserve the
    matching logical group anchor instead of collapsing every intro/child pair back onto
    `group-01`
  - final piece/chunk metadata now drops bridge-only `condition_group_key` /
    `introduced_condition_group_key` after materializing the final group ids, so repeated-group
    numbering no longer depends on downstream contract-builder fallback or leak intermediate
    assembly fields into query-serving metadata
  - `eligibility_intro` contract production now treats chunking-time
    `introduced_condition_group_id` as the canonical intro-group truth and reuses it for the intro
    `condition_group_id`, instead of re-deriving a downgraded parent-subject id after bridge-key
    cleanup
  - final answer-ready contract production no longer reconsumes bridge-only group-key fields after
    `_finalize_answer_ready_segment_metadata(...)` has already materialized canonical final
    `condition_group_id` / `introduced_condition_group_id`; final builder fallback now derives only
    from explicit final ids or canonical shared subject ownership, which removes the last
    post-finalization path that could silently reintroduce `group-01:*` numbering from leaked
    bridge keys
- release chunk quality summary now emits structured answer-ready gate evidence:
  `answer_ready_contract_version`, `answer_ready_required_field_failures`,
  `answer_ready_semantic_failures`, `fallback_budget_status`
- regulation release admission manifest now carries answer-ready gate evidence forward for Phase
  9/10 audit paths, including `semantic_oracle_status`
- shared v3 validation now rejects a first class of query-independent semantic contradictions:
  answer-role/polarity mismatches
  - shared v3 validation now also rejects:
  - `eligibility_intro` chunks that omit the explicit non-answer-bearing flag required by the v3
    intro contract
  - `eligibility_intro` chunks incorrectly marked as final answer-bearing evidence
  - `eligibility_intro` chunks whose `condition_subject` contradicts the subject implied by
    `intro_target_roles`
  - `category_overview` chunks whose `audience` or `member_policy_document_ids` drift from the
    shared category registry
  - `category_overview` chunks whose `member_policy_titles` drift from the shared category
    registry
  - `condition_subject` values whose registry-declared allowed `answer_role` set does not include
    the emitted answer role
  - `condition_subject_taxonomy_version` values that do not match the frozen v3 taxonomy version
  - `condition_group_id` values whose subject tail contradicts the chunk's typed
    `condition_subject`
  - bridge-only `condition_group_key` / `introduced_condition_group_key` fields leaking into final
    answer-ready metadata after chunking-time group-id materialization
  - unknown `condition_group_subject` values that would otherwise pollute typed grouping at
    retrieval time
  - `procedure_action` values whose registry-declared allowed `answer_role` set does not include
    the emitted answer role
  - unknown `procedure_actor` / `procedure_next_actor` values that would otherwise leave v3
    procedure-step metadata outside the shared controlled vocabulary
  - `eligibility_intro` chunks whose `intro_scope` contradicts their typed
    `intro_target_roles`
  - `eligibility_intro` chunks whose `intro_target_roles` contain non-contract role values
  - `eligibility_intro` chunks whose `introduced_condition_group_id` contradicts the typed intro
    subject implied by `intro_target_roles`
  - `eligibility_intro` chunks whose `condition_group_id` and
    `introduced_condition_group_id` disagree on the logical group anchor even if both still end in
    the same typed subject
  - `condition_group_id` values whose anchor does not belong to the chunk's own
    `parent_unit_id`, preventing final v3 metadata from silently pointing at a different article /
    parent clause while keeping the same subject suffix
  - `eligibility_intro` chunks whose `introduced_condition_group_id` points at a different parent
    anchor than the chunk's own `parent_unit_id`, even when the typed intro subject still matches
  - answer-ready roles with a registry-declared expected polarity now fail closed when
    `condition_polarity` is missing, rather than only rejecting unknown/conflicting polarity
    values after the field happens to be present; this now covers judgment-style roles,
    `procedure_step`, `material_requirement`, `time_constraint`, `table_fact`, `definition` and
    `category_overview`
  - `category_overview` is no longer allowed to pass the v3 gate with only list-membership fields:
    it must now also carry the same typed `condition_subject=audience_scope` contract actually
    produced by the builder, including taxonomy version and provenance, so discovery evidence can
    be validated against the same retrieval/eval-facing semantic shape it serves with
  - `category_overview` now also materializes its grouped identity explicitly instead of relying on
    validator-only `condition_group_id` expectations: generated overview chunks carry
    `condition_group_subject=audience_scope` plus canonical
    `condition_group_id=<parent_unit_id>:audience_scope`, and the handbook/institutional overview
    regression rows now freeze `answer_ready_contract_validation_status=passed` for those slices
  - `eligibility_intro` is now held to the same typed intro subject contract that ingestion
    already emits in practice: intros must carry `condition_subject`, taxonomy version and
    provenance in addition to group ids / target roles, rather than only being checked for
    downstream conflicts when those fields happen to be present
  - the previously dormant `requires_condition_group_id(...)` contract is now actually enforced by
    shared validation, so roles that semantically require group anchoring, including grouped
    `table_fact` and `category_overview`, can no longer pass the v3 gate with only a parent id and
    subject while leaving retrieval-facing group identity empty
  - `procedure_step` now also treats `condition_group_subject` as part of the explicit target v3
    contract instead of an optional retrieval sidecar: shared validation and release chunk quality
    fail-close on `answer_ready_condition_group_subject_missing`, while retrieval-side attribute
    access keeps old-index compatibility by canonically recovering the subject from
    `condition_group_id` when explicit metadata is absent
  - at the same time, grouped child units are no longer forced to make
    `condition_subject == condition_group_subject`; `example_evidence` and mixed
    `procedure_step` children can keep their own chunk subject while still pointing at the parent
    condition group through `condition_group_subject` / `condition_group_id`
- regulation chunking now handles a previously uncovered Phase 3 case:
  single enumerated clauses with inline example tails such as
  `且在学术研究上取得显著成绩` are split into parent-preserving child units instead of being emitted
  as one degraded answer-ready chunk
- regulation chunking now also preserves answer-ready child-unit identity for single enumerated
  clauses that previously fell back as one chunk, including:
  - standalone eligibility clauses that now keep `clause_unit_id`
  - standalone procedure clauses under procedure section paths that now retain `procedure_step`
    typing instead of degrading to `eligibility_condition`
- regulation chunking now further splits inline example tails that themselves contain multiple
  example members, so one clause can emit `exception_rule + multiple example_evidence children`
  without collapsing multiple example facts back into one child unit
- regulation chunking now preserves shared scope semantics across sibling clause children instead
  of treating the intro prefix as a one-shot cue:
  - later atomic eligibility clauses under the same `符合下列条件之一` scope no longer drop to
    `supporting_detail`
  - exclusion-style list intros such as `有下列情形之一的，不予解除处分:` now retain clause-level
    child splitting and negative role inheritance for subsequent labeled clauses
  - terminal provisions like `本办法自公布之日起施行` remain protected from false scope promotion
  - pure procedure-duty intros such as `指导教师的职责是:` now keep
    `intro_scope=procedure_list` / `intro_target_roles=("procedure_step",)` because duty-style
    child steps now resolve through the shared procedure action owner instead of degrading to
    `supporting_detail`
- typed grouped intros are now more complete across answer-ready list families:
  - `申请材料如下:` / `证明材料如下:` style intros now emit real `eligibility_intro` chunks with
    `intro_scope=material_list`, `condition_subject=material_requirement`,
    `introduced_condition_group_id` and `intro_target_roles=("material_requirement",)`
  - `申诉期限如下:` / `期限如下:` style intros now emit real `eligibility_intro` chunks with
    `intro_scope=time_list`, `condition_subject=deadline`,
    `introduced_condition_group_id` and `intro_target_roles=("time_constraint",)`
  - institutional-rule variants such as `申诉人应提交以下材料：` and `申诉应在下列期限内提出：` now
    route through the same typed intro/list contract instead of degrading outside the
    student-handbook phrasing set
  - list/group intro cue ownership is now narrower and more explicit:
    - shared registry owns typed list-intro role hints for material/time/procedure-style intro
      lines instead of duplicating those phrase lists across answer-role and chunking modules
    - shared registry also owns group-intro kind detection for
      `符合下列条件之一` / `有下列情形之一` style boundaries plus typed material/time list intros
    - chunking no longer derives intro contract targets from only the first child item under a new
      intro boundary; contiguous child-group analysis now preserves complete mixed-role intro
      contracts such as `("exception_rule", "example_evidence")`
    - heading/category cue ownership is now also split out from list/group intro ownership:
      - shared registry owns short heading role hints for `程序` / `材料` / `期限` / `类别`
        style headings such as `认定程序`、`申诉材料`、`申诉期限`、`免试生类别`
      - heading owner is explicitly narrower than list/group intro owner and only matches short
        heading-like labels, so ordinary full clauses and inline `按如下程序办理:` tails no longer
        get mispromoted to intro/category semantics
- `institutional_rules` no longer relies only on single-clause compatibility proof for answer-ready
  procedure semantics:
  - the collection chunk strategy now routes `regulation_body` units through the same answer-ready
    regulation chunking path used by `student_rules`
  - official-web institutional procedure lists such as `申诉按如下程序办理` now emit typed
    clause-level `procedure_step` child chunks with stable step indexes and
    `application_procedure` grouping instead of collapsing into one undifferentiated chunk
- the Phase 0 oracle sample `学生证丢了怎么补` is now covered by closeout/component proof instead of
  living only in retrieval/golden-case fixtures:
  - typed `procedure_step` chunks for the student-card reissue flow are exercised through
    closeout audit
  - component eval now includes a dedicated positive procedure case for student-card reissue
- deterministic typed answer/grounding integration now also advances beyond generic support
  presence checks:
  - v3 typed drafts now fail closed when key contract fields are missing for
    `category_overview`, `procedure_step`, `eligibility_judgment`, `time_constraint`,
    `material_requirement` and `table_fact`-backed condition rows
  - `RagAgent.build_answer()` no longer erases invalid typed drafts into an opaque `unsupported`
    draft before synthesis, so `typed_answer_draft_invalid` is now a real runtime failure reason
    with preserved typed draft shape
  - deterministic claim supports no longer collapse every condition-table style answer into the
    single generic `condition_row` type; typed row answers now preserve
    `table_fact` / `time_constraint` / `material_requirement` in claim support output while
    component runtime still classifies them under `condition_table` draft kind
- Phase 8 component eval now also includes:
  - fixture-backed case loading for both mandatory scopes via
    `packages/evals/fixtures/answer_ready_component_cases.v1.json`
  - observation loading from deterministic JSON mappings plus explicit empty-path behavior
  - runtime observation harvesting from real `AgentResponse` objects plus retrieval runtime
    fallback observations, so component eval no longer depends on hand-authored observation rows
    only
  - additional oracle-backed denominator rows beyond the original four-case subset, including:
    - `student_scholarship_apply_ambiguous`
    - `student_scholarship_amount_table_fact`
    - `student_national_scholarship_rank`
    - `student_national_scholarship_paper`
    - `student_card_reissue`
    - `student_discipline_relief_exclusion`
    - `student_rules_no_hit`
    - `institutional_appeal_procedure`
    - `institutional_category_discovery`
    - `institutional_rules_no_hit`
  - student-handbook runtime component attribution is no longer over-bound to
    `handbook_query_planning.task_kind` for all document-locked queries:
    - document-locked positive procedure rows such as `处分怎么消` and `学生证丢了怎么补` now project to
      `procedure_lookup`
    - document-locked judgment rows such as `成绩没前十还能评国奖吗` and `论文能不能算国奖条件` now
      project to `eligibility_judgment`
    - planner-owned branches remain explicit only where Phase 0 semantics actually require them,
      such as `category_discovery`, `ambiguous_procedure` and regulation-family no-hit
  - explicit clarification observation semantics:
    - `needs_clarification` + `ambiguous_procedure` now projects to
      `task_kind=ambiguous_procedure`, `answer_role=clarification`,
      `draft_kind=clarification`, `query_polarity=neutral`
    - clarification cases no longer fail component eval just because they have no ranked/selected
      answer-ready evidence
  - explicit unsupported/no-hit observation semantics:
    - `status=no_answer` + `semantic_outcome=unsupported_by_evidence` + empty evidence now projects
      to `task_kind=unsupported_or_no_hit`, `answer_role=unsupported`,
      `draft_kind=unsupported`, `query_polarity=neutral`
    - no-hit cases no longer fail component eval just because they have no ranked/selected
      answer-ready evidence
  - explicit typed-draft-invalid observation semantics:
    - `status=no_answer` + `no_answer_reason=typed_answer_draft_invalid` now remains attached to
      the runtime component observation instead of collapsing into the same bucket as generic
      unsupported/no-hit
    - component eval attributes that runtime shape to `draft_contract_mismatch` and suppresses the
      derivative `grounding_mismatch`, so the primary failure stays on the draft-stage contract
      break instead of double-counting the downstream unsupported grounding state
  - primary and secondary failure stage attribution in oracle order
  - deduplicated gate counting so one case contributes at most one `query_conditioned` and one
    `static_gate` count
  - preferred-role ranking checks so a generic allowed role cannot hide a missed specialized role
    such as `time_constraint` or `material_requirement`

Closed Phase 8 / downstream integration status:

- keep advancing Phase 4/5 structural debt so component failures continue to map onto typed
  metadata rather than fallback heuristics
- Phase 6/11 legacy-signal quarantine moved one step forward in eval policy:
  - component eval no longer treats only `text_cue` as legacy-budget regression
  - legacy primary signals exposed by retrieval runtime, including `public_semantic` and
    `public_content_role`, now also fail target component-eval rows instead of slipping through as
    target-pass behavior
  - target query-enabled regulation release now also enforces this proof at release/admission
    boundaries:
    - `validate_regulation_rag_release_admission_for_release()` rejects target manifests that still
      carry `semantic_oracle_status=pending_phase8` or `fallback_budget_status=not_applicable`
    - `admit_regulation_rag_release` now requires component-eval summary input before writing a
      target release-admission manifest
    - `release_registry_scope` and the regulation candidate executor now fail closed before serving
      publication when target component-eval proof is missing
  - query-serving runtime now also treats release-admission/component-eval proof as part of target
    release metadata for regulation aliases:
    - the Qdrant release guard now requires `release_admission_status=passed` and
      `component_eval_status=passed` for `regulations/student_rules` and
      `regulations/institutional_rules` query-serving aliases
    - aliases that only satisfy generic release metadata but lack target regulation proof now fail
      closed at retrieval runtime instead of being treated as target-v3 serving
  - real Phase 9/10 release artifacts and explicit target-vs-legacy branch separation are no
    longer open gaps
  - target retrieval runtime now fail-closes when `regulations/student_rules` or
    `regulations/institutional_rules` query-serving plans in `target_v3_only` mode try to use
    legacy primary signals (`text_cue`, `public_semantic`, `public_content_role`)
  - old-index compatibility remains possible only through explicit
    `legacy_old_index_compatibility` source-trust policy mode; compatibility reads remain
    observable but are excluded from target completion and target serving truth

Closed Phase 4/5 status:

- ingestion-private semantic cue chains have been moved behind shared, testable assignment owners
  - answer-role detection is now partially migrated as well:
    - `packages/shared` now owns a reusable `resolve_regulation_answer_role(...)` assignment owner
      for core regulation answer-role routing
    - `packages/ingestion-core/src/campus_ingestion_core/regulation_answer_roles.py` no longer
      maintains the primary exclusion/procedure/exception/example/intro detection chain itself and
      now acts mainly as a thin metadata adapter around the shared owner
    - shared coverage freezes procedure-scope single-step, selection-review step, and typed
      material/time intro answer-role routing directly at the shared registry layer
  - deterministic shared keyword-rule lineage remains as an explicit shared assignment owner, not
    an ingestion-private fallback path
- condition-subject grouping now has typed clause/parent-child structured grouping inputs for the
  workstream-owned target cases, including repeated-intro and `clause_unit_id` cases
- metadata-first subject resolution is now wired for `introduced_condition_subject` and
  `condition_group_subject`, and chunking now resolves `action_type` / group subject through
  shared owners instead of local `lift_discipline` text inspection
- answer-ready clause splitting now preserves child-unit identity for the target cases:
  single-clause inline example tails and standalone single-clause answer-ready units are preserved,
  multi-member inline example tails are split, and shared-scope sibling atomic clause inheritance is
  fixed for both positive and negative list intros
- static semantic consistency checks are query-independent rather than only role/field presence
  checks; polarity-role conflict, intro answer-bearing conflict,
  condition-subject/role conflict, procedure-action/role conflict, intro-scope/target-role
  conflict and intro-group-subject conflict are implemented
- typed extraction now covers intro/table/category proof with oracle-backed regression coverage:
  `student_rules`, institutional procedure-list denominator, institutional material/time list-intro
  phrasing and institutional category/deadline/material slices are frozen by dedicated
  oracle-backed extraction regressions:
  - category overview rows now assert registry-backed `category_overview` output for the
    `public_service` institutional category, including `category_id`, `audience`,
    `member_policy_document_ids`, `member_policy_titles`, `category_registry_version` and
    `answer_ready_contract_validation_status=passed`
  - institutional material/deadline list-intro rows now assert stable typed
    `condition_group_subject` / `condition_group_id` / `introduced_condition_group_id` alignment
    between intro and child rows, instead of only checking answer-role assignment
  - this closes the earlier Phase 4 proof gap where institutional procedure list coverage existed
    but institutional category/deadline/material extraction was still fixture-fragile

## Progress

**Phases Complete:** 12 / 12
**Current Plan:** none; closeout evidence is recorded in `ROADMAP.md`, `COMPLETION-AUDIT.md` and
`phases/phase-11-legacy-quarantine-docs-closeout/SUMMARY.md`.

## Blockers

No implementation blocker. The earlier remote Qdrant WAL exhaustion was cleared by repo-governed
preview GC and both default regulation query-enabled scopes now pass real release/adoption proof.
Remaining repo-wide failures are baseline or external-environment issues outside this workstream.

## Guardrails

- Do not reopen supervisor routing, SDK tool schema, public ToolSpec or freshness/live branches.
- Do not treat field presence as semantic correctness.
- Do not count old-index fallback as target completion.
- Do not claim production serving adoption without release manifest and alias evidence.
- Do not promote retrieval-internal metadata into `packages/contracts` unless public DTO consumption
  is explicitly proven.

## Session Continuity

Resume by opening:

1. `README.md`
1. `REQUIREMENTS.md`
1. `ROADMAP.md`
1. `phases/phase-01-contract-v3-and-schema-governance/SUMMARY.md`
1. `phases/phase-02-taxonomy-and-registry-normalization/PLAN.md`
1. `phases/phase-04-typed-semantic-extraction-pipeline/PLAN.md`
1. `packages/shared/src/campus_shared/regulation_semantic_registry.py`
1. `packages/ingestion-core/src/campus_ingestion_core/regulation_evidence_contract.py`
