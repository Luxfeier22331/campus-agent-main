---
doc_type: index
truth_scope: ops
owner_boundary: docs/runbooks/archive
status: active
created: 2026-04-20
updated: 2026-04-20
---
# Runbooks Archive

`runbooks/archive/` 保存仍有独特操作或迁移价值的 legacy runbook。

## Historical Workflows

- `python-ingestion-worker/`
  - historical Python ingestion worker runbooks removed from active operation
    surface.
- `qdrant-cloud-backup-and-restore-runbook.md`
  - superseded Qdrant Cloud / object-store snapshot runbook; current Qdrant
    backup operations are no longer owned by ingestion-worker Python CLIs.

## Usage Rule

- 当前可重复执行的 operator workflow 统一回到 `../README.md`
- 只有在需要追溯仍保留正文的旧 runner 或旧 intake seam 时，才进入本 archive namespace
- 只承担 path redirect 的旧文档不再保留；需要旧正文时通过 git history 追溯
