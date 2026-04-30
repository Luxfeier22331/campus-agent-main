---
doc_type: requirements
status: active
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Requirements: Authenticated Notice Ingest Queue E2E Automation

## Goals

- Freeze a durable ingest queue contract for authenticated notice collector verified runs.
- Make collector success path automatically enqueue ingestion work after run ledger verification.
- Provide a safe manual enqueue / repair path for already collected content without bypassing object storage or run ledger truth.
- Make ingestion worker consume queue jobs by `run_id` and execute the complete import -> media gate -> promotion -> downstream chain without human artifact stitching.
- Add deterministic unattended smoke that prioritizes already collected content and includes image-carried schedule facts such as notice `355867`.

## Functional Requirements

- Queue payload must identify a verified collector run with `run_id`, `source_channel`, `source_surface`, `site_id`, source bucket refs, bundle/manifest hashes and sizes, enqueue source, priority, idempotency key, retry policy, and provenance.
- Queue payload must not carry raw body text, raw HTML, OCR payloads, attachment bytes, local paths, or downstream read-model data.
- Idempotency must dedupe by source channel, surface, site, run id, bundle hash, and manifest hash.
- Queue lifecycle must cover queued, leased/running, succeeded, retryable failure, terminal failure, dead-letter, manual review/blocked, and cancelled semantics.
- Leases must be renewable, expired leases must be reclaimable, and retry scheduling must support `next_retry_after` rather than immediate hot-loop retries.
- Collector enqueue must occur only after the run ledger row is `status=success` and `verification_status=verified`.
- Collector enqueue failure must be observable and retryable without mutating source truth.
- Manual enqueue for existing content must first resolve a verified ledger row or create a repair/synthetic ledger row after source bucket upload and verification.
- Worker consumer must resolve object refs from the ledger or equivalent explicit object refs, verify source objects, and invoke existing importer/closeout/media-gate/promotion modules through repo-owned APIs or CLIs.
- Media gate artifacts must be generated inside the consumer run and recorded under a deterministic operations prefix; promotion must consume the strict audit artifact from that same run.
- Destructive cleanup must remain policy-gated and require non-stale strict audit evidence plus matching candidate inventory hash.
- Downstream materialization/read-model rebuild must run after promotion for explicitly admitted targets only.
- Smoke must validate the full chain from queue row to downstream read model, not just collector or single CLI success.

## Non-Goals

- No replacement of S3-compatible object storage with local filesystem truth.
- No direct collector writes to source-truth, document registry, projection, read model, chunk, index, or runtime serving surfaces.
- No reopening authenticated portal authentication strategy.
- No product/API scheduler or app-api operator control plane in this workstream.
- No fallback path that treats stale local bundle paths as production handoff success.
- No change to restricted/public serving admission policy.
- No new query-serving surface for authenticated notice content.

## Success Criteria

- A verified collector run can enqueue exactly one durable ingest job and repeated enqueue attempts are idempotent.
- Already collected content can be repaired/enqueued through the same queue contract without local-path payloads.
- Queue consumer can claim a job, resolve run ledger object refs, verify source objects, run import/closeout/media gate/promotion/downstream materialization, and mark the job succeeded.
- Retryable object-store or transient processing failures produce retryable queue state with bounded attempts and `next_retry_after`.
- Terminal contract violations produce terminal/manual-review state with actionable failure reason.
- Promotion is impossible unless strict media closeout audit passes and matches the generated candidate inventory.
- Destructive cleanup is impossible unless the cleanup input matches a fresh passed audit and configured policy.
- Captured-content smoke passes for a deterministic sample set including notice `355867` and reports zero medium-or-higher chain findings.
- Operator status can answer: queued/running/succeeded/failed/dead-letter counts, current job, last failure reason, promotion result, downstream materialization result, and smoke verdict.

## Required Verification Lanes

- Python unit tests for queue payload validation, idempotency, lifecycle transitions, retry/manual-review semantics, collector enqueue projection, repair enqueue, and consumer orchestration.
- Worker CLI tests for enqueue, consume, show, and smoke commands.
- In-memory and Postgres store tests for lease/retry behavior.
- Captured-content smoke over existing authenticated notice artifacts, not fresh collector smoke.
- `uv run --all-packages ruff check .`
- `uv run --all-packages ruff format . --check`
- `uv run --all-packages python -m unittest discover -s tests -t .`
- `pnpm docs:lint`
- `git diff --check`
