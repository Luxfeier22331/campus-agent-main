---
doc_type: summary
status: completed
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Phase 0 Summary: Boundary And Inventory Scope

## Result

Phase 0 froze the `official-web-target-inventory` boundary and corrected the planning risks found in
review.

The target inventory contract is separate from `target-source-map.json`:

- `target-source-map.json` remains family-level collection admission truth.
- Page-level target inventory will live in `configs/sources/official_web/muc_public/target-inventory.json`.
- Inventory entries reference existing target-source-map rows through `admission_target_id`.
- `target-source-map.json` must not receive page-level fields such as `source_urls`,
  `required_fields`, `release_blockers` or `preview_status` without an explicit schema upgrade.

## Boundary Decisions

Admitted initial downstream surfaces:

- `service_guide_lookup`
- `contact_directory_lookup`
- `official_web/stable_reference`

Excluded or inventory-only:

- broad crawl as a collection target
- `fresh_news` / `news_archive` runtime opening
- direct service catalog or stable-reference current-truth write
- authenticated notice portal collection
- `notice_news_candidate` promotion

## Ownership Decision

`official-web-collection-restart-closeout` remains active for closeout evidence, but scheduler
expansion, import and promote handoff work for target content is gated by this workstream until
accepted targets have source-backed no-promotion preview evidence.

## Evidence Decision

Live public URLs may seed candidate discovery. They are not sufficient as release evidence.

Accepted inventory targets require replayable evidence from no-promotion preview:

- app-api run id
- target job or attempt id
- source object keys
- raw asset id
- raw version id
- staged-only ingestion status
- null current-truth import unless a later release workstream admits selected write

## Files Updated

- `README.md`
- `REQUIREMENTS.md`
- `ROADMAP.md`
- `STATE.md`
- `TARGET-INVENTORY-DESIGN.md`
- Phase outlines for contract, discovery, preview, readiness and closeout
- `.planning/WORKSTREAMS.md`

## Verification

Planned verification:

```bash
gsd-sdk query workstream.status official-web-target-inventory --raw --cwd "$PWD"
git diff --check -- .planning/workstreams/official-web-target-inventory .planning/WORKSTREAMS.md
pnpm docs:lint
```
