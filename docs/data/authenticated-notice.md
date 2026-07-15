---
doc_type: data
truth_scope: domain
owner_boundary: authenticated-notice
status: active
created: 2026-04-02
updated: 2026-07-13
---
# Authenticated Notice Data

## Notice Capture

Input contract: `internal_portal_notice_capture_request.v1`.

Supported request controls:

- `collection_mode`: `incremental`, `backfill`, or `selected`;
- optional positive `max_notices`;
- selected notice ids/types for `selected` mode.

The collector writes the provider/export bundle, capture release, content
blocks, attachment refs, and captured attachment objects to the source bucket.
It validates same-bucket refs and SHA-256 before producing
`authenticated_notice_source_manifest.v1`.

## File Release Capture

Input contract: `internal_portal_file_release_capture_request.v1`.

Supported request controls:

- page size and optional page/item limits;
- optional exact file-release id.

The result includes only verified object-backed source artifacts.
`reference_only` is not converted into a successful source object.

## Shared Task Result

Both tasks return `ingestion_task_result.v1` with:

- task/run/registry identity;
- the registry output contract;
- one digest-pinned source result manifest;
- bounded counts such as notices, files, pages, attachments, or uploads.

Detailed failures and source rows remain in object storage. They are not copied
into PostgreSQL or Temporal signals.

## Relational Data

There are no authenticated-notice-specific app-api or collector tables. The
only relational state is the shared `ingestion_control.tasks` projection. It
contains source family/channel, terminal status, result presence, bounded
summary, and bounded error fields.

## Downstream Boundary

These source manifests are not canonical notice read models, regulation rows,
chunks, vectors, aliases, or query-serving data. Any downstream system must
declare a separate executable task and output contract only when that complete
implementation exists.

## Related Documents

- `docs/architecture/domains/authenticated-notice/architecture.md`
- `docs/contracts/file-release-export.md`
- `docs/data/wechat-official.md`
