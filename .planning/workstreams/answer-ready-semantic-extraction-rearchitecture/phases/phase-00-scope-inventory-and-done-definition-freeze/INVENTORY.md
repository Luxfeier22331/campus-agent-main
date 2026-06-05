---
doc_type: phase_artifact
status: completed
created: 2026-05-07
updated: 2026-05-07
---

<!-- markdownlint-disable MD013 -->

# Inventory: Current V2 Answer-Ready Evidence State

## Summary

Current worktree has an `answer_ready_evidence.v2` contract that flows through shared schema,
ingestion quality checks, retrieval attributes, ranking features and component eval. It is a useful
bridge, but it is not the v3 no-debt target because important semantic fields still have heuristic
lineage and production release adoption is not proven for both default regulation scopes.

## Current Producers

| Field / Behavior | Current Producer | Current State | V3 Gap |
|------------------|------------------|---------------|--------|
| `evidence_contract_version` | `packages/shared/src/campus_shared/answer_ready_evidence_contract.py` and ingestion metadata builders | Fixed as `answer_ready_evidence.v2` | Needs `answer_ready_evidence.v3` with migration and release invalidation rules |
| `answer_role` vocabulary | ingestion semantic/chunking pipeline and existing answer-role classifiers | Present for target role families | Needs v3 role matrix tied to semantic oracle |
| `parent_unit_id` | ingestion contract builder, fallback to root/source unit | Present | Needs clause/parent-child unit model and stability guarantees |
| `condition_subject` | `regulation_evidence_contract.infer_condition_subject` | Present where inferred | Still cue/section-text driven; must move to taxonomy/registry/structured-unit provenance |
| `condition_polarity` | `infer_condition_polarity` | Present for key roles | Needs controlled polarity semantics and oracle validation |
| `condition_group_id` | `infer_condition_group_id` | Present where grouped subject can be inferred | Needs stable production grouping from clause/parent-child model |
| procedure fields | `build_procedure_step_metadata` | Present for actor/action/materials/next actor | Actor/action/materials still cue-driven; needs taxonomy and alias registry |
| eligibility intro fields | `build_eligibility_intro_metadata` | Present for intro scope/group/target roles | Needs typed intro contract tied to group semantics and non-answer-bearing guarantee |
| category overview metadata | `build_category_overview_contract_metadata` plus registry postprocess | Present for category overview path | Needs generalized registry coverage beyond scholarship-like proof |
| release gate status | `answer_ready_contract_quality.evaluate_answer_ready_contract_metadata` and registry scope release summary | Present as v2 quality check | Needs static semantic correctness admission and v3 required fields |

## Current Consumers

| Consumer | File | Current Use | V3 Gap |
|----------|------|-------------|--------|
| release/chunk quality | `packages/ingestion-core/src/campus_ingestion_core/answer_ready_contract_quality.py` | Fails on missing required v2 fields | Needs v3 role-specific correctness and static-only gate split |
| retrieval projection | `packages/retrieval-core/src/campus_retrieval_core/evidence_attributes.py` | Reads internal evidence anchor and produces typed attributes plus legacy-signal diagnostics | Needs v3 version/readiness classification and old-index-only signal quarantine |
| semantic ranking | `packages/retrieval-core/src/campus_retrieval_core/evidence_semantics.py` | Uses typed attributes and query cue inference to score alignment | Needs oracle-backed query intent and less ad hoc query cue dependence |
| ranking features | `packages/retrieval-core/src/campus_retrieval_core/evidence_ranking_features.py` | Penalizes legacy signals for strong query intent and adds semantic alignment score | Needs zero primary legacy-signal assertion for target v3 releases |
| component eval | `packages/evals/src/campus_evals/answer_ready_component_eval.py` | Checks intent/retrieval/ranking/selection/draft/grounding mismatch | Needs release-contract and semantic-contract failure classes plus oracle input |
| typed answer draft | `packages/rag-agent` typed answer modules | Consumes answer-ready evidence indirectly | Needs explicit v3 draft/grounding expectations from semantic oracle |

## Heuristic Lineage Map

| Heuristic Source | Current Examples | Required V3 Replacement |
|------------------|------------------|-------------------------|
| Chinese content cues | `排名`, `前10%`, `论文`, `发表`, `处分`, `材料`, `公示` | condition taxonomy plus structured section/category provenance |
| section-path cues | `程序`, `流程`, `材料`, `截止`, `对象` | normalized section kind and taxonomy-mapped section category |
| procedure action cues | `挂失`, `补办`, `申诉`, `提交`, `审核`, `公示`, `办理` | action taxonomy with alias registry and explicit unknown handling |
| query intent cues | `怎么`, `有哪些`, `不能`, `能不能`, `论文`, `奖学金` | component semantic oracle plus typed query-intent taxonomy |
| category cues | `奖学金`, `资助`, `奖励` | generalized category registry with aliases and member policies |

## Missing Semantic Correctness Checks

- No frozen oracle maps samples to expected role/subject/polarity/group/draft/grounding.
- Release admission validates fields but not all v3 static semantic invariants.
- Query-conditioned contradictions are partially handled by ranking but not systematically attributed.
- Institutional-rule semantic fixtures are not present early enough.
- Taxonomy value changes do not yet force release invalidation or revalidation.
- Old-index fallback is observable but not yet quarantined from target completion.

## Files To Change In Later Phases

Expected implementation files:

- `packages/shared/src/campus_shared/answer_ready_evidence_contract.py`
- `packages/ingestion-core/src/campus_ingestion_core/regulation_evidence_contract.py`
- `packages/ingestion-core/src/campus_ingestion_core/regulation_chunking.py`
- `packages/ingestion-core/src/campus_ingestion_core/answer_ready_contract_quality.py`
- `packages/ingestion-core/src/campus_ingestion_core/regulation_rag_release_admission.py`
- `packages/retrieval-core/src/campus_retrieval_core/evidence_attributes.py`
- `packages/retrieval-core/src/campus_retrieval_core/evidence_semantics.py`
- `packages/retrieval-core/src/campus_retrieval_core/evidence_ranking_features.py`
- `packages/evals/src/campus_evals/answer_ready_component_eval.py`
- `packages/rag-agent/src/campus_rag_agent/typed_answer_drafts.py`

Expected test owners:

- `tests/shared/test_answer_ready_evidence_contract.py`
- `tests/ingestion/test_handbook_chunking_pipeline.py`
- `tests/ingestion/test_index_release_acceptance.py`
- `tests/ingestion/test_registry_scope_release_acceptance_wiring.py`
- `tests/retrieval/evidence_attributes_suite.py`
- `tests/retrieval/evidence_contract_ranking_suite.py`
- `tests/evals/answer_ready_component_eval_suite.py`
- `tests/agent/rag_agent_typed_answer_drafts_suite.py`
- institutional-rule-specific tests to be added in Phase 1-4
