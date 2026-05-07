---
doc_type: phase_artifact
status: completed
created: 2026-05-07
updated: 2026-05-07
---

<!-- markdownlint-disable MD013 -->

# Release Lane Entrypoints

## Environment Prerequisites

Release execution requires the normal ingestion-worker environment:

- object store settings for derived artifacts
- document registry access
- runtime profile files for target scope
- Qdrant credentials
- embedding provider credentials/cache
- acceptance case path
- selected preparation run id

Phase 9/10 must record any missing env as blockers, not substitute ad hoc release paths.

## Admission Manifest

Command template:

```bash
uv run --all-packages python -m campus_ingestion_worker.admit_regulation_rag_release \
  --corpus regulations \
  --collection <student_rules|institutional_rules> \
  --preparation-run-id <preparation-run-id> \
  --admission-run-id <admission-run-id> \
  --note answer_ready_evidence.v3
```

Required output fields:

- `schema_version=regulation_rag_release_admission_worker_report.v1`
- `corpus`
- `collection`
- `preparation_run_id`
- `admission_run_id`
- `admission_manifest_object_key`
- `document_count`
- `document_ids`
- `version_ids`
- `admission_manifest.answer_ready_contract_status`

## Candidate Enqueue

Mandatory only when the candidate processor path is chosen. The current worker CLI exposes explicit
enqueue for `institutional_rules`; `student_rules` Phase 9 should use the direct registry-scope path
unless a valid pre-existing pending `student_rules` candidate is intentionally processed as
diagnostic evidence.

```bash
uv run --all-packages python -m campus_ingestion_worker.enqueue_regulation_rag_release_candidates \
  --corpus regulations \
  --collection institutional_rules \
  --document-id <document-id> \
  --force \
  --output <artifact-path>
```

Required output fields:

- `schema_version=regulation_rag_release_candidate_enqueue.v1`
- `created_count`
- `forced_reenqueue_count`
- `candidate_ids`
- `collections.institutional_rules.candidate_ids`

## Release Path Choice

Phase 9/10 must choose exactly one release execution path and record the rationale:

- `registry_scope_release` path: use `campus_ingestion_worker.release_registry_scope` directly for
  a prepared registry scope.
- `candidate_processor` path: enqueue/process regulation release candidates with
  `campus_ingestion_worker.enqueue_regulation_rag_release_candidates` and
  `campus_ingestion_worker.process_regulation_rag_release_candidates`.

Do not run both paths as mandatory steps for the same scope release. If both are run for comparison,
only one can be the serving adoption path, and the other must be recorded as diagnostic.

Phase-specific default:

- Phase 9 `student_rules`: use `registry_scope_release` for serving adoption.
- Phase 10 `institutional_rules`: may use either path, but candidate enqueue/processing is required
  only for the candidate-processor path.

## Candidate Processing Path

```bash
uv run --all-packages python -m campus_ingestion_worker.process_regulation_rag_release_candidates \
  --candidate-id <candidate-id> \
  --release-admission-manifest-key <manifest-key> \
  --acceptance-case-path <path> \
  --publish-alias
```

Required output fields:

- `processed_count`
- `candidate_ids`
- `status_counts`
- `admission_blocked_count`

The candidate processor output proves processing status. Release id, release admission status,
retrieval acceptance status, post-publish audit status and alias publish status must be captured
from the terminal candidate record or the release output produced by the executor for the chosen
serving-adoption path.

## Registry Scope Release Path

Direct release command:

```bash
uv run --all-packages python -m campus_ingestion_worker.release_registry_scope \
  --corpus regulations \
  --collection <student_rules|institutional_rules> \
  --preparation-run-id <preparation-run-id> \
  --release-admission-manifest-key <manifest-key> \
  --acceptance-case-path <path> \
  --publish-alias
```

Required output fields:

- `release_id`
- `corpus`
- `collection`
- `physical_collection_name`
- `manifest_object_key`
- `document_count`
- `point_count`
- `validation_status`
- `retrieval_acceptance_status`
- `post_publish_audit_status`
- `release_admission_manifest_key`
- `release_admission_status`
- `published_at`
- `telemetry`

## Alias Operation

Explicit alias adoption or correction. This command is not required after a successful
`--publish-alias` release unless the phase intentionally performs an explicit alias adoption check or
correction:

```bash
uv run --all-packages python -m campus_ingestion_worker.scope_alias \
  --corpus regulations \
  --collection <student_rules|institutional_rules> \
  --physical-collection-name <physical-collection-name> \
  --expected-current-physical-collection-name <optional-current> \
  --action-reason answer-ready-v3-adoption
```

Required output fields:

- `serving_alias`
- `action`
- `previous_physical_collection_name`
- `current_physical_collection_name`
- `expected_current_physical_collection_name`
- `action_reason`

## Dry-Run Vs Publish Posture

- Phase 0-8 must not publish aliases.
- Phase 9/10 may publish or explicitly adopt aliases only after all gates pass.
- A dry-run is useful evidence for command readiness but cannot satisfy serving adoption.

## Artifact Capture

Phase 9/10 summaries must link:

- admission command output JSON
- release/candidate command output JSON
- alias operation output JSON, or the release output JSON when `--publish-alias` is the chosen alias
  proof
- component oracle eval JSON
- post-publish audit JSON or release output field proving audit status
