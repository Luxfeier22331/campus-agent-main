---
doc_type: roadmap
status: active
created: 2026-05-02
updated: 2026-05-02
---
# Historical Regulation Denominator Expansion Roadmap

## Phase 00: Denominator Audit

Status: `completed`

Classify run14 historical regulation-like notices into ready and recovery/block
sets without opening serving or release lanes.

Evidence:

- `./evidence/phase-00-denominator-audit/denominator-audit.json`
- `./evidence/phase-00-denominator-audit/ready-canonical-chunk-candidates.json`
- `./evidence/phase-00-denominator-audit/recovery-backlog.json`

## Phase 01: Body-Text Owner Admission

Status: `implemented`

Convert ready normalized notice bodies into source-truth owner-text refs and
emit regulation admission/candidate audit artifacts.

## Phase 02: Canonical Materialization

Status: `implemented`

Run current regulation canonical cleaner and materialize canonical markdown plus
document-units into derived object storage semantics.

## Phase 03: Chunk-Only Preparation

Status: `implemented`

Prepare chunks from registry-backed document-units only. Do not run embedding or
release.

## Phase 04: Final Quality Audit

Status: `implemented`

Audit normalization, chunk preparation verdict and object-store key compliance.

## Phase 05: Operator Review And Handoff

Status: `pending`

Review emitted evidence, decide whether the expanded denominator can be counted
as chunk-quality accepted, and only then decide if a separate release-lane phase
should consume it later.
