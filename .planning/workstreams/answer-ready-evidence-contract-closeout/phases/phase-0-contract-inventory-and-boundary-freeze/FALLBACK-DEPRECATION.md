---
doc_type: fallback_deprecation
status: active
created: 2026-05-06
updated: 2026-05-06
---

<!-- markdownlint-disable MD013 -->

# Fallback Deprecation: Text Cue Compatibility

Current code still uses Chinese cue rules in `evidence_semantics.py`, `query_focus.py` and
`agent_selection_rows.py`. Those paths can remain only as compatibility fallback after this
workstream.

## Allowed Fallback

- Old indexes without `evidence_contract_version`.
- Non-target chunks whose metadata is explicitly absent and whose response is not one of the target
  answer-ready regression cases.
- Diagnostic-only ranking explanation when typed metadata is present but incomplete.

## Disallowed Fallback

- Rebuilt query-serving `student_rules` target cases passing primarily through cue parsing.
- Release-admitted chunks hiding missing `answer_role`, `condition_subject`, `parent_unit_id` or
  `evidence_contract_version`.
- Positive procedure queries selecting negative restriction evidence because text cues overrode typed
  polarity/role metadata.

## Required Diagnostics

- `fallback_used`
- `fallback_reason`
- `missing_contract_fields`
- `source_index_contract_version`
- `fallback_primary_signal`

## Fallback Budget

| Scope | Budget |
| --- | --- |
| Target regression cases after rebuilt `student_rules` index | `0` primary fallback cases |
| Old-index compatibility tests | allowed, must report fallback diagnostics |
| Non-target regulation queries | allowed temporarily, must be counted |

## Target Cases Where Fallback Must Fail

- `处分怎么消`
- `哪些情况不能解除处分`
- `成绩没前十还能评国奖吗`
- `论文能不能算国奖条件`
- `本科生有哪些奖学金能申请`
- `奖学金怎么申请`

## Phase 3 Requirement

Phase 3 tests must assert both outcome correctness and that typed evidence metadata, not text cues,
is the primary ranking/selection signal for rebuilt target cases.
