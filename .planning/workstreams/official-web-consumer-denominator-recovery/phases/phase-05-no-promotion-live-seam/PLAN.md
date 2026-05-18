---
doc_type: plan
status: completed
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Phase 5 Plan: No-Promotion Live Seam

## Goal

Prove the bounded official-web consumer-denominator chain without promoting registry current truth.

## Chain

`collector -> app-api lifecycle -> object storage -> handoff receiver -> ingestion staging`

## Tasks

1. Add or update a direct-process smoke profile for consumer-denominator official-web collection.
2. Run with a bounded host/page budget and no promotion flag.
3. Verify object-store artifacts only exist for retained consumer candidates.
4. Verify app-api run lifecycle and artifact refs.
5. Verify handoff receiver can consume the run into ingestion staging.
6. Verify no document registry promotion, serving alias update or query-serving opening occurs.
7. Write a smoke report path into the workstream state.

## Verification

Commands depend on the final smoke entrypoint created in this phase. The required evidence is:

- app-api run id
- object keys for retained source-truth
- handoff id
- candidate counts by consumer family
- no-promotion proof
- rejected reason counts

## Acceptance

- The live seam works with consumer-denominator scope.
- No broad collection is required to prove the seam.
- No registry current truth changes.
- No serving alias changes.
