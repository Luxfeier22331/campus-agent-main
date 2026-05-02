---
doc_type: plan
status: active
created: 2026-05-02
updated: 2026-05-02
---

<!-- markdownlint-disable MD013 -->

# Phase 1 Plan: Core Schema And Report Gate

1. Add optional evidence and optional fields to official-web config models.
2. Validate required/optional arrays for uniqueness, no overlap and cross-config alignment.
3. Update target inventory reports to include optional metadata.
4. Treat absent optional fields as `source_not_provided` and exclude them from blockers.
