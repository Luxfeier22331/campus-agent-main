---
doc_type: legacy_signal_deprecation
status: active
created: 2026-05-06
updated: 2026-05-06
---

<!-- markdownlint-disable MD013 -->

# Legacy Signal Deprecation: Text Cue Quarantine

Current code still uses Chinese cue rules in `evidence_semantics.py`, `query_focus.py` and
`agent_selection_rows.py`. Those paths are legacy diagnostics only after this workstream; they do
not define an allowed product fallback or a second serving path.

## Legacy Diagnostic Scope

- Old-index quarantine samples without `evidence_contract_version`.
- Non-target chunks whose metadata absence is explicitly recorded and whose response is not one of
  the target answer-ready regression cases.
- Diagnostic-only ranking explanation when typed metadata is present but incomplete; the response
  still follows fail-closed answer-readiness rules.

## Disallowed Product Path

- Rebuilt query-serving `student_rules` target cases passing primarily through cue parsing.
- Release-admitted chunks hiding missing `answer_role`, `condition_subject`, `parent_unit_id` or
  `evidence_contract_version`.
- Positive procedure queries selecting negative restriction evidence because text cues overrode typed
  polarity/role metadata.

## Required Diagnostics

These field names are historical compatibility labels. They are kept only to make old-index
quarantine evidence auditable; they are not permission to add fallback behavior.

- `fallback_used`
- `fallback_reason`
- `missing_contract_fields`
- `source_index_contract_version`
- `fallback_primary_signal`

## Legacy Signal Budget

| Scope | Budget |
| --- | --- |
| Target regression cases after rebuilt `student_rules` index | `0` primary legacy cue cases |
| Old-index quarantine tests | diagnostic-only, must report legacy cue diagnostics |
| Non-target regulation queries | must be counted; query-serving promotion requires typed evidence |

## Target Cases Where Legacy Cues Must Fail

- `处分怎么消`
- `哪些情况不能解除处分`
- `成绩没前十还能评国奖吗`
- `论文能不能算国奖条件`
- `本科生有哪些奖学金能申请`
- `奖学金怎么申请`

## Phase 3 Requirement

Phase 3 tests must assert both outcome correctness and that typed evidence metadata, not text cues,
is the primary ranking/selection signal for rebuilt target cases.
