# Quality Pilot Acceptance

## Cohort A Verdict

- Cohort A verdict: `ready_for_chunk_prep`
- Source of record:
  - `.planning/quick/260410-5yl-internal-notice-policy-regulation-cohort/cohort-a-validation-summary.json`
  - `.planning/quick/260410-5yl-internal-notice-policy-regulation-cohort/cohort-a-quality-summary.md`
  - `.planning/quick/260410-5yl-internal-notice-policy-regulation-cohort/cohort-a-samples/`
- This quick task uses the machine-readable summary and sample evidence above as the acceptance truth instead of re-summarizing from memory.

## Local-Only Boundary

- This was a `local-only` Cohort A quality pilot over `.tmp/historical-intake/run14-policy-regulation-expanded/local-smoke/`.
- The task performed `no Postgres` reads or writes, `no Qdrant` access, no embeddings, no chunk-preparation manifests, no release manifests, and no serving aliases.
- The quick harness only injected repo-local registry, source-truth inventory, and filesystem object-store artifacts into `scan_internal_notice_chunking(...)`.

## Wrapper Follow-Up Boundary

- `355282` only advances after live attachment backfill confirms the canonical guidance document is `text_extractable`; it does not enter the current Cohort A body-text baseline before that.
- `351704` only advances through attachment-hash dedupe plus cloud async OCR of the shared PDF handbook; native PDF fallback is explicitly forbidden.
- `351699` only advances through attachment-hash dedupe plus cloud async OCR of the shared PDF handbook; native PDF fallback is explicitly forbidden.
- `351119` remains blocked on external canonical document acquisition; the current wrapper notice stays outside Cohort A.
- `177880` stays a wrapper-summary-only notice until canonical body exists; the current donor summary is not promoted into body-text baseline truth.
- Cohort B/C are `wrapper/canonical-body follow-up` inputs for later work, not hidden failures inside the current Cohort A baseline.
