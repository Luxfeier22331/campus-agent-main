---
doc_type: plan
status: planned
created: 2026-05-03
updated: 2026-05-03
---

<!-- markdownlint-disable MD013 -->

# Phase 3 Plan: One-Time Capture And Source Truth

## Goal

Capture manifest URLs once and validate official-web source-truth artifacts without current-truth
promotion.

## Tasks

- Add or reuse a batch runner that executes validated manifest rows one URL at a time.
- Ensure runner never expands from host, seed or discovered links.
- Write acceptance run evidence through app-api target workset and run ledger.
- Allow artifact-only local evidence only for extractor/source-truth unit proof, not pack
  acceptance.
- Validate `capture/`, `provider/` and `source-truth/` artifacts.
- Produce QC reports and per-row outcome summary.
- Record failed rows as blocked/deferred with retry reason.

## Acceptance Criteria

- Each ready manifest URL has a source-truth artifact or a machine-checkable failure reason.
- Discovered links are retained only for audit.
- No current structured projection, document release or alias promotion happens during capture.
- Capture output preserves source URL, final URL, fetched timestamp, content hash and page title.
- Acceptance evidence includes app-api target admission and run ledger linkage.

## Verification

```bash
pnpm --dir apps/official-web-collector validate
pnpm --dir apps/official-web-collector qc-report
```

For live seam single-row proof:

```bash
uv run --all-packages python scripts/official_web_live_seam_no_promotion.py \
  --site-id muc_public \
  --host <host> \
  --target-id <entry-id> \
  --target-url <url> \
  --max-pages-per-host 1 \
  --max-total-pages 1
```
