---
doc_type: index
truth_scope: ops
owner_boundary: docs/runbooks/archive
status: active
created: 2026-04-20
updated: 2026-04-20
---
# Runbooks Archive

`runbooks/archive/` 保存已退出默认执行面的 legacy runbook 与历史路径 redirect note。

## Historical Workflows

- `authenticated-notice/README.md`
- `python-ingestion-worker/`
  - historical Python ingestion worker runbooks removed from active operation
    surface.
- `qdrant-cloud-backup-and-restore-runbook.md`
  - superseded Qdrant Cloud / object-store snapshot runbook; current Qdrant
    backup operations are no longer owned by ingestion-worker Python CLIs.

## Path Redirects

- `path-redirects/README.md`

## Usage Rule

- 当前可重复执行的 operator workflow 统一回到 `../README.md`
- 只有在需要追溯旧 runner、旧 intake seam 或旧模板路径时，才进入本 archive namespace
