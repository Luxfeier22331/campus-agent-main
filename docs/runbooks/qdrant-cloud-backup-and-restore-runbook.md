---
doc_type: runbook
status: historical
created: 2026-03-31
updated: 2026-06-01
---
# Qdrant Cloud Backup And Restore Runbook

## Historical Status

This runbook is retained only to explain the superseded Qdrant Cloud /
object-store snapshot direction from ADR-0020.

The active staging and early-production path is:

- `docs/decisions/adr-0045-self-hosted-single-node-qdrant-and-native-backups.md`
- `docs/runbooks/self-hosted-qdrant-native-backup-runbook.md`

Do not use Qdrant Cloud Standard automatic backups or Free tier
snapshot-to-object-storage as the default backup path for current staging or
early production.

## Superseded Model

ADR-0020 assumed two cloud paths:

- Qdrant Cloud Standard automatic backups as the long-term managed recovery
  surface.
- Free tier collection snapshots uploaded into the derived bucket under
  `{corpus}/backups/{collection}/{release_id}/{backup_id}/...`.

That assumption is no longer current. ADR-0045 supersedes it with a
self-hosted single-node Qdrant deployment and qdrant-native snapshots archived
on the server filesystem plus an off-host copy.

## Historical Object-Store Cleanup

The old derived-bucket backup prefix may still exist in historical MinIO/R2
data. Cleanup must use the exact-key cleanup command:

```bash
uv run --all-packages campus-ingestion-qdrant-backup-cleanup plan \
  --output-dir var/qdrant-backup-cleanup/<run_id> \
  --current-alias student_rules=<physical_collection> \
  --obsolete-family regulations/student_handbook

uv run --all-packages campus-ingestion-qdrant-backup-cleanup delete \
  --plan-path var/qdrant-backup-cleanup/<run_id>/deletion-plan.json \
  --output-dir var/qdrant-backup-cleanup/<run_id>
```

The cleanup command only deletes object keys listed in the generated
`deletion-plan.json`; it must not be replaced with prefix deletion.

## References

- Superseded ADR: `docs/decisions/adr-0020-qdrant-cloud-backup-restore-and-object-store-transition.md`
- Active ADR: `docs/decisions/adr-0045-self-hosted-single-node-qdrant-and-native-backups.md`
- Active runbook: `docs/runbooks/self-hosted-qdrant-native-backup-runbook.md`
