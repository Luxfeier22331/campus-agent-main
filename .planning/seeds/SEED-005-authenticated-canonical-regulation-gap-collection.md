---
id: SEED-005
status: dormant
planted: 2026-05-10
planted_during: eval workstream closeout
trigger_when: authenticated canonical regulation sources are available for collection and promotion
scope: Medium
surfaced_as: null
---

<!-- markdownlint-disable MD013 -->

# SEED-005: Authenticated Canonical Regulation Gap Collection

## Why This Matters

The eval workstream closed current-corpus golden dataset governance on 2026-05-10. Some student-facing
queries still point to canonical regulations that are not present in the current document library.

The known concrete gap is `中央民族大学本科生创新教育学分认定管理办法`. Historical authenticated
notice text references this rule, but that reference is not the canonical regulation source. Eval
should keep these cases as known-gap/no-hit checks until the source owner collects and admits the
canonical document.

This is a source collection and domain promotion task, not an eval blocker.

## When to Surface

**Trigger:** authenticated canonical regulation sources become available, or the product decides to
reopen authenticated source collection for missing student/institutional regulations.

Surface this seed when any of these conditions are true:

- authenticated portal access is available for collecting canonical regulation attachments or pages
- a domain/source workstream needs to backfill missing student-facing canonical rules
- known-gap cases in `rag_known_gap_cases.v1.json` are ready to be promoted to accepted qrels /
  answer truth
- downstream docs/RAG wants to answer innovation-credit recognition queries from canonical source
  text rather than related implementation rules or notice references

## Scope Estimate

**Medium** — likely requires authenticated source capture, canonical document import, regulation
cleaning/chunking, document-site/RAG promotion, and eval promotion from known-gap to accepted truth.

## Breadcrumbs

- `packages/evals/fixtures/rag_known_gap_cases.v1.json`
- `packages/evals/fixtures/student_rules_answer_quality_cases.v1.json`
- `.planning/workstreams/eval/GAP-LEDGER.md`
- `.planning/workstreams/eval/evidence/rag-eval-coverage/rag-eval-coverage.json`
- `.planning/workstreams/eval/phases/phase-5b-golden-dataset-expansion-and-domain-case-governance/PLAN.md`
- `docs/architecture/domains/authenticated-notice/architecture.md`
- `docs/data/authenticated-notice-source-truth-schema.md`

## Notes

- Do not promote historical notice references, nearby policy titles, or synthetic answers as
  canonical regulation truth.
- Keep known-gap/no-hit behavior until canonical source text has stable source/version provenance.
- Promotion should update source truth, document-site/RAG consumption, qrels, answer-quality cases,
  and release acceptance evidence together.
- This seed may become a new source/domain workstream; it should not reopen eval unless shared eval
  governance or fixture admission contracts need to change.
