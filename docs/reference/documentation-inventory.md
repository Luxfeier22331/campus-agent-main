---
doc_type: reference
truth_scope: repository
owner_boundary: docs
status: active
created: 2026-06-13
updated: 2026-06-27
---
# Documentation Inventory

This document is the compact governance snapshot for `docs/`.

It is not a full per-file ledger, content audit, completion report, workstream
state board or replacement for `docs/documentation-architecture.md`.

## Snapshot

- Current-worktree docs Markdown files: 245
- Git tracked docs Markdown files: 245
- Untracked docs Markdown files included: 0
- Generated on: 2026-06-27

## Governance Rules

- Durable facts must live in one owner document class, as defined by
  `docs/documentation-architecture.md`.
- Narrow capabilities keep one canonical human document. Machine-readable
  JSON Schema, OpenAPI and fixtures may remain separate executable contracts.
- `reference/` and `runbooks/` archive material must keep earning its
  branch-tip body. If the only remaining value is historical traceability, use
  git history instead of keeping a tracked redirect or obsolete full text.
- ADRs keep their historical lifecycle. Supersede or deprecate ADRs; do not
  delete them only to shorten names or remove old context.
- This inventory records counts and governance hotspots. It must not return to
  a hand-maintained full tree mirror.

## Cleanup Hotspots

- Python ingestion worker archive bodies were removed from branch tip. Current
  ingestion/data-plane operations start at `docs/runbooks/ingestion-control-clean-target-runbook.md`.
- Campus Services human truth is intentionally narrow. The current canonical
  transport document is `docs/domains/transport.md`; generic service guide,
  contact directory and process lookup docs are not active surfaces.
- Historical reference/runbook bodies under `docs/reference/archive/` and
  `docs/runbooks/archive/` should stay only when they contain unique retained
  evidence that is still cited with historical context.
- Large active docs are acceptable only when owner-clean. If a large document
  mixes active work status, release proof, architecture truth and reference
  material, split or delete the mixed section rather than adding another
  summary document.
