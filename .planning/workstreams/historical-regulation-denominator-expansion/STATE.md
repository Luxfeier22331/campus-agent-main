---
doc_type: state
status: completed
workstream: historical-regulation-denominator-expansion
created: 2026-05-02
updated: 2026-05-03
---
# Historical Regulation Denominator Expansion State

## Current Position

**Status:** Completed
**Current Phase:** Phase 07 closeout
**Last Activity:** 2026-05-03
**Last Activity Description:** Closed out the denominator expansion workstream
after confirming Phase 01-04 canonical/document-units/chunk quality, Phase 05
school-level inventory and Phase 06 owner-text recovery audit. No additional
canonical/chunk admissions were created after Phase 06. No embedding, candidate
enqueue/processor, release admission, index release, alias publish, document-site
publish or query serving was opened.

## Current Denominator

Phase 00 result:

- input notice count: 16
- ready for canonical/chunk v9: 9
- recovery/block: 7

Ready IDs:

- `354006`
- `353963`
- `351907`
- `196411`
- `191705`
- `191176`
- `187004`
- `186977`
- `186957`

Downstream-eligible ready IDs:

- `191705`

Chunk-only non-serving scoped ready IDs:

- `354006`
- `353963`
- `351907`
- `196411`
- `191176`
- `187004`
- `186977`
- `186957`

Recovery/block IDs:

- `355282`
- `351704`
- `351699`
- `351119`
- `191177`
- `187233`
- `177880`

## Current Stop Point

This workstream must stop at canonical/document-units/chunk quality. It must not
open candidate enqueue, candidate processor, embedding, index release, release
admission or alias publish. It also must not publish `scoped_rules` to document
site/read-model or enqueue `scoped_rules` for RAG release.

Closeout result:

- completed canonical/document-units/chunk notice-derived regulations: 9
- `institutional_rules`: 1
- `scoped_rules`: 8
- chunks prepared: 172
- document-site/RAG downstream-eligible under current policy: 1
- blocked owner-source records: 3
- hold records: 4

Combined with the completed `historical-regulation-canonical-chunk-backfill`
workstream, the repo now has 51 notice-derived regulation artifacts that have
completed canonical/document-units/chunk quality:

- `institutional_rules`: 30
- `scoped_rules`: 21
- total chunks: 1945

These counts are chunk-quality counts, not publication counts. A separate
release gate is still required before document-site or RAG consumption.

Backlog handoff:

- `.planning/todos/pending/2026-05-03-recover-blocked-school-level-notice-regulation-owner-sources.md`
  captures the three校级 blocked owner-source records for future human recovery:
  `355282`, `187233` and `177880`.

## Phase 05 School-Level Inventory

Evidence root:

```text
.planning/workstreams/historical-regulation-denominator-expansion/evidence/phase-05-school-level-inventory/
```

Actual run command:

```bash
uv run --all-packages campus-ingestion-audit-historical-regulation-school-level-inventory
```

Inventory result:

- input notice count: 16
- school-level ready for canonical/chunk: 1
- scoped rule chunk-only non-serving: 8
- wrapper needs owner-text recovery: 1
- wrapper summary backlog: 2
- operator excluded hold: 1
- duplicate hold: 1
- not regulation-like hold: 2

School-level ready ID:

- `191705`

Scoped chunk-only non-serving IDs:

- `354006`
- `353963`
- `351907`
- `196411`
- `191176`
- `187004`
- `186977`
- `186957`

Recovery/backlog IDs:

- `355282`
- `187233`
- `177880`

Hold IDs:

- `351704`
- `351699`
- `351119`
- `191177`

Important path/classification checks:

- `191705` targets `regulations/documents/institutional_rules/中央民族大学丰台校区就医管理办法-暂行--88e8a049/current-effective/undated/`
- `187233` remains `wrapper_needs_owner_text_recovery`, but its future target
  path is校级 `institutional_rules`, not `scoped_rules`.
- `191176` is the survivor for duplicate `191177`; `191177` remains hold.

## Phase 06 School-Level Owner-Text Recovery Audit

Evidence root:

```text
.planning/workstreams/historical-regulation-denominator-expansion/evidence/phase-06-school-level-owner-text-recovery/
```

Actual run command:

```bash
uv run --all-packages campus-ingestion-audit-historical-regulation-school-level-owner-recovery
```

Recovery audit result:

- target notice IDs: `355282`, `187233`, `177880`
- source candidate notice IDs: none
- blocked notice IDs: `355282`, `187233`, `177880`
- canonical/chunk ready notice IDs: none
- `blocked_no_owner_source`: 2
- `blocked_incomplete_owner_text`: 1

Per-target findings:

- `355282`: blocked, notice body is wrapper/summary for
  `中央民族大学关于学生使用人工智能的指导意见（2026版）`; no captured
  attachment or link.
- `187233`: blocked, body contains procurement revision notice and procurement
  notes, not complete `中央民族大学采购工作管理办法` owner text.
- `177880`: blocked, notice body is summary for
  `中央民族大学学生申诉管理办法`; no captured attachment or link.

This means Phase 06 adds no new canonical/document-units/chunk target. These
three records require a future external owner source before they can be admitted.
The future human recovery task is tracked in
`.planning/todos/pending/2026-05-03-recover-blocked-school-level-notice-regulation-owner-sources.md`.

## Latest Execution Evidence

Actual run command:

```bash
uv run --all-packages campus-ingestion-backfill-historical-regulation-denominator-expansion --execute
```

Evidence root:

```text
.planning/workstreams/historical-regulation-denominator-expansion/evidence/phase-01-04-canonical-chunk-backfill/
```

Final quality audit:

- final verdict: `passed`
- materialized document count: 9
- normalization failed/flagged document count: 0
- chunk preparation overall verdict: `passed`
- prepared document count: 9
- total chunk count: 172
- object-store key checked count: 27
- object-store key failed count: 0
- candidate store mutated: false
- embedding opened: false
- candidate enqueue opened: false
- candidate processor opened: false
- release admission opened: false
- index release opened: false
- alias publish opened: false
- query serving opened: false

Chunk validation:

- `institutional_rules`: passed, 1 document, 9 units, 9 chunks, 0 failed docs
- `scoped_rules`: passed, 8 documents, 205 units, 163 chunks, 0 failed docs

Notable fixes made during execution:

- canonical cleaner now removes college/hospital/center publication signature
  tails at ingest layer, including embedded signature suffixes while preserving
  real contact content such as complaint phone lines.
- mixed ASCII/CJK artifact detection no longer flags valid email, room/address
  and score formula content as soft-wrap residue.
- chunk quality audit no longer treats office-address lines as publication
  imprint residue and no longer blocks short academic subject chunks such as
  `新闻传播学`.
- document-units lineage now keeps historical notice-body sources as
  `notice_body` instead of fabricating attachment ownership.

## Verification Commands

Focused verification:

```bash
uv run --all-packages python -m unittest tests.ingestion.test_regulation_chunk_quality tests.ingestion.test_collected_notice_regulation_text_normalization tests.ingestion.test_collected_notice_regulation_first_batch_promotion tests.ingestion.test_historical_regulation_denominator_expansion tests.ingestion.test_audit_historical_regulation_denominator_expansion_worker tests.ingestion.test_historical_regulation_denominator_body_text_admission tests.ingestion.test_backfill_historical_regulation_denominator_expansion_worker tests.ingestion.test_internal_notice_institutional_regulation_chunk_prep tests.ingestion.test_internal_notice_scoped_rule_chunk_prep
uv run --all-packages python -m unittest tests.ingestion.test_historical_regulation_denominator_expansion tests.ingestion.test_audit_historical_regulation_denominator_expansion_worker tests.ingestion.test_historical_regulation_denominator_body_text_admission tests.ingestion.test_backfill_historical_regulation_denominator_expansion_worker
uv run --all-packages python -m unittest tests.ingestion.test_collected_notice_regulation_first_batch_promotion tests.ingestion.test_internal_notice_scoped_rule_chunk_prep tests.ingestion.test_internal_notice_institutional_regulation_chunk_prep
```

Latest focused verification result:

- 70 tests passed.

Actual run14 evidence command:

```bash
uv run --all-packages campus-ingestion-backfill-historical-regulation-denominator-expansion --execute
```

Phase 05 inventory verification:

```bash
uv run --all-packages python -m unittest tests.ingestion.test_historical_regulation_school_level_inventory tests.ingestion.test_audit_historical_regulation_school_level_inventory_worker
```

Phase 06 owner-text recovery verification:

```bash
uv run --all-packages python -m unittest tests.ingestion.test_historical_regulation_school_level_owner_recovery tests.ingestion.test_audit_historical_regulation_school_level_owner_recovery_worker
```

Closeout evidence:

```text
.planning/workstreams/historical-regulation-denominator-expansion/evidence/phase-07-closeout/closeout-summary.json
```
