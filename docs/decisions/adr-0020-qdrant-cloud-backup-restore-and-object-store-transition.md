---
doc_type: decision
truth_scope: repository
owner_boundary: docs/decisions
decision_id: ADR-0020
status: superseded
created: 2026-03-31
updated: 2026-06-01
superseded_by: ADR-0052
---
# ADR-0020 Qdrant Cloud Backup Restore And Object-Store Transition

## Superseded

ADR-0052 supersedes this decision.

Current staging and early production do not use Qdrant Cloud or the old
snapshot-to-object-storage backup path. The active decision is:

- `docs/decisions/adr-0052-self-hosted-single-node-qdrant-and-native-backups.md`

The active runbook is:

- `docs/runbooks/self-hosted-qdrant-native-backup-runbook.md`

## Historical Summary

This ADR previously assumed:

- Qdrant Cloud Standard automatic backups would become the long-term managed
  recovery surface.
- Free tier deployments would export per-collection snapshots to the derived
  bucket under
  `{corpus}/backups/{collection}/{release_id}/{backup_id}/...`.
- Those object-store bundles would carry `backup-manifest.json`,
  `<physical_collection_name>.snapshot`, and optional `restore-report.json`.

That model is no longer accepted as the current path.

## Replacement

The replacement model is:

- self-hosted single-node Qdrant for staging and early production
- native collection snapshots as the main backup artifact
- server filesystem archive under
  `/srv/backups/campus-agent/qdrant-snapshots/`
- off-host archive copy
- no Qdrant `.snapshot` files in staging R2 or serving seed buckets

Historical object-store backup objects may still exist. They are cleanup
targets only and must be deleted through exact-key deletion plans, not prefix
deletion.
