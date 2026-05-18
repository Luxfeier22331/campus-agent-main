---
doc_type: roadmap
status: completed
created: 2026-05-02
updated: 2026-05-03
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

Status: `completed`

Convert ready normalized notice bodies into source-truth owner-text refs and
emit regulation admission/candidate audit artifacts.

## Phase 02: Canonical Materialization

Status: `completed`

Run current regulation canonical cleaner and materialize canonical markdown plus
document-units into derived object storage semantics.

## Phase 03: Chunk-Only Preparation

Status: `completed`

Prepare chunks from registry-backed document-units only. Do not run embedding or
release.

## Phase 04: Final Quality Audit

Status: `completed`

Audit normalization, chunk preparation verdict and object-store key compliance.

## Phase 05: Operator Review And Handoff

Status: `completed`

Audit already-collected regulation-like notices against the narrowed policy that
only school-level `institutional_rules` can later enter document-site or RAG
consumption. Preserve院级/专项 `scoped_rules` as chunk-only non-serving evidence,
and keep wrapper / incomplete owner-text / duplicate / non-regulation records
out of downstream consumption.

Evidence:

- `./evidence/phase-05-school-level-inventory/school-level-inventory.json`
- `./evidence/phase-05-school-level-inventory/school-level-ready-candidates.json`
- `./evidence/phase-05-school-level-inventory/non-serving-scoped-rules.json`
- `./evidence/phase-05-school-level-inventory/recovery-backlog.json`

## Phase 06: School-Level Owner-Text Recovery Audit

Status: `completed`

Audit the校级 recovery/backlog targets from Phase 05 against the already-collected
run14 normalized bundle. This phase only checks whether a real owner source is
available; it does not extract owner text, materialize canonical documents,
prepare chunks or open downstream consumption.

Evidence:

- `./evidence/phase-06-school-level-owner-text-recovery/owner-text-recovery-audit.json`
- `./evidence/phase-06-school-level-owner-text-recovery/source-candidate-manifest.json`
- `./evidence/phase-06-school-level-owner-text-recovery/blocked-owner-source-backlog.json`

## Phase 07: Closeout And Registry Update

Status: `completed`

Close the workstream with explicit counts and stop-point evidence. This phase
does not materialize additional canonical documents or open downstream
consumption.

Evidence:

- `./evidence/phase-07-closeout/closeout-summary.json`
