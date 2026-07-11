---
doc_type: architecture
truth_scope: data
owner_boundary: domains/calendar
status: active
created: 2026-07-08
updated: 2026-07-08
---
# Calendar Domain Architecture

## Boundary

`calendar` owns structured academic and operational date facts that users ask
as dates, periods, week numbers or school-day state.

It is a domain capability, not a child of `official_web`. Official-web pages,
notices, regulations, imported PDFs or operator corrections may all be source
inputs, but none of those source channels owns the final calendar truth.

## Current Posture

No model-visible calendar tool is currently opened.

Calendar facts may appear in source-truth or prework collections, but the
current runtime must not expose `academic_calendar_lookup`, generic
`calendar_lookup` or a campus-services calendar tool until the structured source
truth, merge rules, read model, runtime contract and eval denominator are
defined together.

## Target Shape

The target shape is a structured read model with explicit provenance:

```text
source channel captures
-> event extraction / operator review
-> calendar fact table
-> conflict / supersession policy
-> release current pointer
-> read-only calendar tool
```

The tool should answer questions such as:

- current teaching week
- semester start / registration / exam / holiday / make-up class dates
- date ranges for a named academic period
- whether a date is a teaching day, holiday, exam period or make-up day

The model should consume resolved calendar facts from the read model. It should
not calculate teaching week from raw prose when a structured calendar release is
available.

## Source Inputs

Allowed source inputs:

- official academic calendar pages or PDFs
- official notices that announce make-up classes, holiday adjustments or
  deadline changes
- regulations that define stable rules for academic periods
- operator-reviewed corrections with provenance

A notice can affect calendar facts, but it remains a source event. The calendar
domain owns how that event supersedes, amends or annotates the released calendar
read model.

## Forbidden Shapes

- Do not create `official_web/calendar` as the final target owner.
- Do not fold calendar into `campus_services` merely because it is a student
  service question.
- Do not let LLMs compute current teaching week from unstructured snippets at
  answer time when a structured release exists.
- Do not expose a model-visible calendar tool before conflict handling,
  currentness, provenance and release pointer semantics exist.
- Do not treat every date mentioned in a notice as a calendar event; extraction
  must classify whether the date is a deadline, event date, publication date,
  effective date, holiday adjustment or unrelated text.

## Related Documents

- `../official-web/architecture.md`
- `../campus-services/architecture.md`
- `../../system/retrieval-serving.md`
