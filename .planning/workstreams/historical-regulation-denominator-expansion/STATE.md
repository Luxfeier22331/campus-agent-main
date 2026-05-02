---
doc_type: state
status: active
workstream: historical-regulation-denominator-expansion
created: 2026-05-02
updated: 2026-05-02
---
# Historical Regulation Denominator Expansion State

## Current Position

**Status:** Active
**Current Phase:** Phase 05 operator review and handoff
**Last Activity:** 2026-05-02
**Last Activity Description:** Executed Phase 01-04 for the 9 ready historical
regulation notices. Canonical normalization, document-units materialization,
chunk-only preparation, object-store key audit and closed-serving assertions now
pass. No embedding, candidate enqueue/processor, release admission, index
release or alias publish was opened.

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
admission or alias publish.

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
- total chunk count: 165
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

- `institutional_rules`: passed, 1 document, 8 units, 8 chunks, 0 failed docs
- `scoped_rules`: passed, 8 documents, 205 units, 157 chunks, 0 failed docs

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
