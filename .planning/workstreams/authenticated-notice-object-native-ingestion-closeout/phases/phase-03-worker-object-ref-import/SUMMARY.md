---
doc_type: summary
status: completed
created: 2026-04-30
updated: 2026-04-30
---

<!-- markdownlint-disable MD013 -->

# Phase 3 Summary: Worker Object-Ref Import

Completed worker-side object-ref import.

- Notice and file-release importers support `--run-id` and explicit source-bucket object refs.
- Python worker resolves verified run-ledger rows without reading collector local export paths.
- Bundle and manifest bytes are loaded from object storage with optional hash/size verification.
- Bare local path import fails closed unless fixture/dev import is explicitly allowed.
