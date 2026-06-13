---
doc_type: runbook
status: active
created: 2026-05-18
updated: 2026-05-18
---

# Authenticated Notice Source Bucket Attachment Cleanup

## Scope

This runbook covers `campus-rag-source` attachment objects under
`authenticated_notice_portal/attachment-*`.

Do not clean this prefix by raw prefix deletion. Cleanup must be driven by
source-truth attachment refs and retention metadata.

Canonical keep rules:

- Keep objects referenced by `source-truth/attachment-refs.jsonl` with
  `required_source_object=true`.
- Keep promoted or admitted source bytes.
- Keep active quarantine candidates whose `retention_expires_at` has not passed.
- Do not delete referenced `metadata_only` objects directly. They indicate
  source-truth drift and need source-truth repair before object deletion.

Cleanup candidate rules:

- `unreferenced_attachment_object`: object exists in the source bucket but no
  canonical `source-truth/attachment-refs.jsonl` references it.
- `expired_quarantine_candidate`: referenced quarantine object whose retention
  window has expired and is not required or promoted. This still requires the
  media-closeout-gated quarantine cleanup path before deletion.

## Audit

Run a read-only audit:

```bash
out="var/source-bucket-cleanup/authenticated-notice-attachments-$(date +%Y%m%dT%H%M%S%z)"
uv run --all-packages python -m \
  campus_ingestion_worker.audit_authenticated_notice_source_attachment_keys \
  --output-dir "$out" \
  --now "$(date -Iseconds)"
```

Important outputs:

- `summary.json`
- `canonical-attachment-keep.jsonl`
- `canonical-attachment-cleanup-candidates.jsonl`
- `canonical-attachment-unreferenced-candidates.jsonl`
- `canonical-attachment-review-required.jsonl`

The audit is non-destructive.

## Dry Run

Dry-run unreferenced object cleanup:

```bash
uv run --all-packages python -m \
  campus_ingestion_worker.cleanup_authenticated_notice_source_attachment_keys \
  --canonical-unreferenced-inventory-path \
  "$out/canonical-attachment-unreferenced-candidates.jsonl" \
  --output-dir "$out/dry-run-unreferenced" \
  --dry-run
```

This writes:

- `dry-run-canonical-unreferenced-attachment-objects.jsonl`
- `canonical-unreferenced-attachment-cleanup-summary.json`

## Delete

Destructive deletion requires an explicit operator approval for the exact audit
directory and candidate inventory.

After approval:

```bash
uv run --all-packages python -m \
  campus_ingestion_worker.cleanup_authenticated_notice_source_attachment_keys \
  --canonical-unreferenced-inventory-path \
  "$out/canonical-attachment-unreferenced-candidates.jsonl" \
  --output-dir "$out/delete-unreferenced" \
  --yes
```

The cleanup command records deleted and already-absent objects and verifies each
deleted object is absent after deletion.

## Quarantine Candidates

Do not pass `expired_quarantine_candidate` rows to the unreferenced cleanup
command.

Expired quarantine deletion must use the media-closeout-gated quarantine cleanup
path:

```bash
uv run --all-packages python -m \
  campus_ingestion_worker.cleanup_authenticated_notice_source_attachment_keys \
  --quarantine-attachment-refs-path <attachment-refs.jsonl> \
  --media-extraction-candidate-inventory-path \
  <media-extraction-candidate-inventory.json> \
  --media-closeout-audit-path <passed-media-closeout-audit.json> \
  --output-dir <cleanup-output-dir> \
  --now "$(date -Iseconds)" \
  --yes
```

The media closeout audit must be strict, passed, and tied to the candidate
inventory hash.

## Source Run Retention Audit

`authenticated_notice_portal/runs/` is source bucket run evidence, not attachment
storage. Do not delete it by raw prefix age.

Run a read-only source run audit:

```bash
out="var/source-bucket-cleanup/authenticated-notice-source-runs-$(date +%Y%m%dT%H%M%S%z)"
uv run --all-packages python -m \
  campus_ingestion_worker.audit_authenticated_notice_source_run_retention \
  --output-dir "$out"
```

Important outputs:

- `summary.json`
- `run-inventory.jsonl`
- `protected-runs.jsonl`
- `delete-candidate-runs.jsonl`
- `delete-candidate-objects.jsonl`

Classification rules:

- `protected_db_referenced_run`: a database row still references this source run.
- `protected_repo_referenced_run`: repo docs/planning/code/tests still reference
  this run.
- `delete_candidate_debug_source_run`: debug/probe/smoke/eval/local run with no
  DB or repo reference.
- `delete_candidate_unreferenced_source_run`: no DB or repo reference.

This command is non-destructive. A later cleanup command must consume the exact
`delete-candidate-objects.jsonl` inventory and verify post-delete absence.

## Source Run Dry Run

Dry-run source run cleanup:

```bash
uv run --all-packages python -m \
  campus_ingestion_worker.cleanup_authenticated_notice_source_runs \
  --candidate-objects-path "$out/delete-candidate-objects.jsonl" \
  --output-dir "$out/dry-run-source-runs" \
  --dry-run
```

This writes:

- `dry-run-objects.jsonl`
- `summary.json`

## Source Run Delete

Destructive deletion requires explicit operator approval for the exact audit
directory and candidate inventory.

After approval:

```bash
uv run --all-packages python -m \
  campus_ingestion_worker.cleanup_authenticated_notice_source_runs \
  --candidate-objects-path "$out/delete-candidate-objects.jsonl" \
  --output-dir "$out/delete-source-runs" \
  --yes
```

The cleanup command only accepts `delete_candidate_*` source run rows under
`authenticated_notice_portal/runs/` in the configured source bucket. It records
deleted and already-absent objects and verifies each deleted object is absent
after deletion.

## Local Evidence

The 2026-05-18 local audit wrote evidence under:

`var/source-bucket-cleanup/authenticated-notice-attachments-20260518T202118+0800/`

Summary:

- `canonical_attachment_key_count`: 10,135
- `canonical_attachment_unreferenced_count`: 9,821
- `canonical_attachment_unreferenced_byte_size`: 6,778,834,306 bytes
- `canonical_attachment_cleanup_candidate_count`: 4
- `canonical_attachment_cleanup_candidate_byte_size`: 361,224 bytes
- `canonical_attachment_review_required_count`: 310
- `canonical_attachment_review_required_byte_size`: 111,916,064 bytes

No destructive cleanup was executed during this audit.
