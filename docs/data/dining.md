---
doc_type: data
truth_scope: data
owner_boundary: domains/dining
status: active
created: 2026-06-08
updated: 2026-07-04
---
# Dining Operations Schema

## 文档边界

本文冻结 `dining.*` logical schema、ownership 与数据面边界。

它回答：

- dining operations 中哪些对象是 draft truth
- release candidate 如何冻结 draft version 并进入发布控制面
- release snapshot 如何成为学生端 published projection truth
- source observation 与 draft/published 的关系
- audit event 记录什么

它不负责：

- app-api HTTP shape，见 `docs/contracts/app-api/dining-ops.md`
- student public dining HTTP shape，见 `docs/contracts/app-api/dining.md`
- Operator Console operations UI，见 `docs/architecture/system/operator-console.md`
- navigation spatial truth，见 `docs/architecture/domains/navigation/architecture.md`

## Ownership

`packages/domains/dining` owns dining domain model, floorplan scaffold,
local/dev seed, draft/release/projection rules and floorplan manifest
validation. Its public TypeScript surfaces are `@campus-agent/dining/domain`
and `@campus-agent/dining/floorplans`.

`jobs/dining-sync` owns dining data production jobs:

- `catalog-observations` reads Feishu/Lark catalog tables and upserts accepted
  or blocked catalog facts into `dining.source_observations`
- `publish-catalog` refreshes Feishu/Lark catalog observations, then
  materializes active accepted observations into `dining.*` catalog/release
  tables
- `publish-catalog-from-observations` materializes active accepted PG
  observations without calling Feishu/Lark
- `import-dev-seed` writes the repo committed floorplan validation seed into
  `dining.*` for local/dev and is rejected in production
- `sync-all` refreshes and publishes catalog, then syncs Feishu/Lark review
  records into
  `dining.source_observations(source_type=feishu_review)`, then publishes
  active accepted review observations into `dining.review_projections`
- `run` only executes the review sync phase and requires existing active
  Feishu/Lark catalog observations for stall/window binding

`apps/app-api` owns the HTTP facade and Worker/Drizzle PG adapter only. It
serves `/api/dining/*` and `/api/ops/dining/*`, but it must not own catalog
fixture source truth or call Feishu/Lark.

The persisted published snapshot is the only student visibility truth. A repo
SVG asset, floorplan manifest entry or scaffold hall row does not make a dining
hall visible until a release snapshot is written and pointed to by
`dining.release_latest_pointer`.

`apps/operator-console-web` consumes ops routes and does not own storage truth.
`apps/campus-web` consumes published `/api/dining/*` and does not own storage truth.

## Schema Family

Accepted target logical tables:

- `dining.halls`
- `dining.floors`
- `dining.windows`
- `dining.window_assignments`
- `dining.stall_profiles`
- `dining.menu_items`
- `dining.menu_offerings`
- `dining.review_projections`
- `dining.source_observations`
- `dining.source_sync_runs`
- `dining.draft_versions`
- `dining.release_candidates`
- `dining.release_candidate_validation_reports`
- `dining.release_schedule_jobs`
- `dining.releases`
- `dining.release_snapshots`
- `dining.release_latest_pointer`
- `dining.audit_events`

## Object Boundaries

### `dining.halls`

Dining hall identity and campus grouping.

Canonical fields:

- `hall_id`
- `campus`
- `name`
- `status`
- `created_at`
- `updated_at`

### `dining.floors`

Hall floor identity and repo floorplan manifest relation.

Canonical fields:

- `floor_id`
- `hall_id`
- `label`
- `floorplan_id`
- `floorplan_sha256`
- `sort_key`
- `created_at`
- `updated_at`

Rules:

- `floorplan_id` references a repo-owned generated floorplan manifest entry
- `floorplan_sha256` records the manifest checksum currently expected by dining
  draft/release validation
- `floor_id` 是地图投影标识，不总是学生端可见的建筑楼层。单地图食堂可以使用
  `floor_id = hall_id`；其地图标签为 "地图"，`campus-web` 隐藏地图切换控件。
- floor rows do not store SVG bytes, object-store keys, menu, price, assignment
  or release status truth
- changing the SVG floorplan is an application release that updates the
  floorplan manifest; ordinary ops draft edits do not replace SVG assets

### `dining.windows`

Physical indoor window area on a dining floor.

Canonical fields:

- `window_id`
- `hall_id`
- `floor_id`
- `label`
- `location_label`
- `svg_anchor_id`
- `geometry_json`
- `tags_json`
- `status`
- `created_at`
- `updated_at`

Rules:

- `svg_anchor_id` binds the window to a versioned floor SVG manifest
  `data-dining-anchor-id`
- `geometry_json` is legacy/editor geometry only and does not define the
  student floorplan interaction model
- student-facing copy treats window/stall as one "档口" concept; public routes
  must not expose unreliable notes as location, status or description truth
- window status does not imply menu availability
- window truth is separate from stall profile and menu truth

### `dining.stall_profiles`

Operator-managed stall identity independent from physical window.

Canonical fields:

- `stall_profile_id`
- `display_name`
- `stall_type`
- `tags_json`
- `status`
- `created_at`
- `updated_at`

### `dining.window_assignments`

Assignment of a stall profile to a physical window.

Canonical fields:

- `assignment_id`
- `window_id`
- `stall_profile_id`
- `status`
- `effective_from`
- `effective_to`
- `created_at`
- `updated_at`

Rules:

- menu offerings attach to assignment, not physical window
- replacing a stall profile does not delete physical window truth

### `dining.menu_items`

Menu item identity.

Canonical fields:

- `menu_item_id`
- `name`
- `tags_json`
- `status`
- `created_at`
- `updated_at`

### `dining.menu_offerings`

Offer of a menu item at a window assignment with display price reference.

Canonical fields:

- `offering_id`
- `assignment_id`
- `menu_item_id`
- `price_label`
- `created_at`
- `updated_at`

Rules:

- `price_label` is nullable display text, not numeric pricing truth
- missing source price is represented as `NULL`; consumers must not synthesize
  "待更新", "未知" or fake price text
- menu portion/spec labels are not current scope
- real-time availability, sale status and queue state are not in scope

### `dining.source_observations`

Implemented source observation/proposal table. Current implemented writers are
`jobs/dining-sync catalog-observations`, which stores Feishu/Lark catalog facts
with `source_type='feishu_catalog'`, and review sync, which stores Feishu/Lark
review facts with `source_type='feishu_review'`.

Canonical fields:

- `observation_id`
- `source_type`
- `source_base_token`
- `source_table_id`
- `source_record_id`
- `target_kind`
- `target_id`
- `payload_json`
- `content_hash`
- `status`
- `observed_at`
- `first_seen_at`
- `last_seen_at`
- `last_seen_run_id`
- `stale_at`
- `reviewed_at`
- `reviewed_by`

Rules:

- observation does not mutate draft or published snapshot by itself
- `publish-catalog` and `publish-catalog-from-observations` are the current
  explicit materialization commands for accepted Feishu/Lark catalog
  observations; review sync materializes active accepted
  `feishu_review` observations into review projections
- `catalog-observations` uses `observation_id` as the idempotency key and does
  not delete existing rows
- rows observed in a previous run but not seen in the current Feishu/Lark sync
  are marked with `stale_at`; replay and publish consume only rows where
  `stale_at IS NULL`
- `content_hash` is deterministic over the normalized publishable observation
  payload and status; it excludes run id and wall-clock observation metadata
- current HTTP surfaces do not expose observation list/apply/reject commands
- blocked observations record deterministic source-shape failures such as
  missing linked campus/hall/stall or missing required display names
- blocked review observations record moderation failures, image moderation
  failures and rows that cannot resolve to the current published catalog
  stall/window
- provider, config, object-store or DB failures are sync-run failures; they are
  not converted into blocked source observations
- manual apply/reject, if accepted later, must be explicit operator
  commands and must not be hidden in app-api readers

### `dining.source_sync_runs`

Implemented source sync run table for `jobs/dining-sync catalog-observations`,
the refresh phase of `publish-catalog` and Feishu/Lark review sync.

Canonical fields:

- `run_id`
- `source_type`
- `started_at`
- `completed_at`
- `status`
- `total_count`
- `accepted_count`
- `blocked_count`
- `stale_count`
- `error_message`

Rules:

- the table records sync batch state, not raw Feishu/Lark rows
- it is not a user-facing audit log and must not be exposed through student
  browser APIs
- object storage is not used for raw catalog archive in the current batch;
  object storage remains limited to review image attachment materialization

### `dining.review_projections`

Published review projection served by
`GET /api/dining/halls/:hallId/reviews`.

Canonical fields:

- `review_id`
- `source_record_id`
- `campus`
- `hall_id`
- `hall_name`
- `stall_profile_id`
- `window_id`
- `stall_name`
- `dish_name`
- `paid_price_label`
- `rating`
- `comment`
- `contributor_name`
- `images_json`
- `published_at`

Rules:

- `source_record_id` records the accepted Feishu/Lark source row id; raw source
  JSON is not stored in this public projection
- `stall_profile_id` and `window_id` bind the review to the current published
  catalog stall/window for map placement
- the projection preserves submitted `stallName` and `dishName` as free text
- rows must resolve explicit `campus + hall + stall` input to current published
  catalog ids before publication
- student UI uses `stallName` and `dishName` only to group reviews under the
  current stall/dish context, not as repeated review-card titles
- inconsistent records are not guessed into another campus or hall
- image URLs point to public S3-compatible/static object URLs
- Lark / Feishu file tokens and raw attachment URLs are not public schema fields
- sync writes replace the projection deterministically for accepted rows
- review projection writes do not create `halls`, `windows`, `stall_profiles`,
  `menu_items`, `menu_offerings` or `window_assignments`
- review sync must not write `feishu_catalog` observations

### `dining.draft_versions`

Monotonic draft version record used to freeze release candidates.

Canonical fields:

- `draft_version_id`
- `version_number`
- `summary_json`
- `created_at`
- `created_by`

Rules:

- every draft mutation that can affect published projection advances the draft
  version or records a deterministic version boundary
- release candidates reference a specific draft version through
  `base_draft_version_id`
- a candidate is stale when publish-time draft/version invariants no longer
  match the candidate policy

### `dining.release_candidates`

Frozen candidate prepared from a specific draft version.

Canonical fields:

- `candidate_id`
- `base_draft_version_id`
- `status`
- `notes`
- `publish_mode`
- `scheduled_at`
- `expected_predecessor_release_id`
- `snapshot_hash`
- `floorplan_manifest_refs_json`
- `snapshot_payload_json`
- `created_at`
- `created_by`
- `approved_at`
- `approved_by`
- `cancelled_at`
- `cancelled_by`
- `published_release_id`

Allowed status values:

- `candidate`
- `validated`
- `approved`
- `scheduled`
- `publishing`
- `published`
- `failed`
- `cancelled`

Rules:

- candidate creation freezes the draft version, floorplan manifest refs/checksums,
  extracted anchors, window-anchor bindings and candidate snapshot hash
- a candidate can be published immediately or scheduled after approval
- publish commands operate on candidates, not mutable draft
- candidate failure does not update the latest published pointer
- cancelled candidates are retained for audit and cannot be published

### `dining.release_candidate_validation_reports`

Validation output attached to a release candidate.

Canonical fields:

- `validation_report_id`
- `candidate_id`
- `status`
- `blockers_json`
- `warnings_json`
- `summary_json`
- `created_at`

Rules:

- blocker-free validation is required before approval and publish
- blockers include missing floorplan manifest entry, missing/duplicate required
  anchors, checksum mismatch, stale candidate and missing student projection
  fields
- warnings may inform operators but do not replace explicit blockers

### `dining.release_schedule_jobs`

Scheduled execution request for an approved release candidate.

Canonical fields:

- `schedule_job_id`
- `candidate_id`
- `scheduled_at`
- `status`
- `attempt_count`
- `last_error_code`
- `last_error_message`
- `created_at`
- `created_by`
- `executed_at`

Rules:

- scheduled jobs target approved candidates only
- scheduler execution must revalidate candidate invariants before publish
- scheduler must never publish mutable current draft state
- failed jobs retain diagnostic error fields and do not update latest published
  pointer

### `dining.releases`

Published release metadata.

Canonical fields:

- `release_id`
- `candidate_id`
- `notes`
- `status`
- `published_at`
- `published_by`
- `predecessor_release_id`
- `snapshot_hash`
- `created_at`
- `created_by`

Rules:

- release rows represent published releases only
- release rows are created by publishing an approved candidate
- rollback does not mutate draft; it either updates the latest pointer to a
  previous release or creates a new candidate from a historical snapshot

### `dining.release_snapshots`

Immutable published payload for student-facing dining projection.

Canonical fields:

- `snapshot_id`
- `release_id`
- `payload_json`
- `floorplan_manifest_refs_json`
- `snapshot_hash`
- `created_at`

Rules:

- student `/api/dining/*` reads latest published snapshot
- snapshots are not recomputed from draft at query time
- missing published release yields empty/typed not-found behavior, not fallback
  fixture data
- student projection uses window -> assignment -> stall profile -> menu offering
  -> menu item relations captured inside the snapshot
- snapshot payload must include floorplan manifest id, static asset path,
  checksum, anchor inventory and SVG anchor bindings for any student-visible
  floor
- missing floorplan, stall profile or menu item projection data is a data
  integrity error; readers must fail closed rather than synthesize placeholder
  SVG anchors, food names, prices or tags

### `dining.release_latest_pointer`

Singleton or scoped pointer to the release currently served to student-facing
routes.

Canonical fields:

- `scope`
- `release_id`
- `snapshot_id`
- `updated_at`
- `updated_by`

Rules:

- latest pointer is updated only after a complete release snapshot is written
- release publish is atomic from the student reader perspective
- partial publish never advances this pointer

### `dining.audit_events`

Operator action event.

Canonical fields:

- `audit_event_id`
- `action`
- `actor_display_name`
- `actor_principal_id`
- `object_id`
- `object_kind`
- `before_json`
- `after_json`
- `occurred_at`

Rules:

- audit event stores object-level summaries
- audit event does not store raw auth rows, cookies, tokens, or secrets

## Production Catalog And Bootstrap Fixture

Production catalog ownership belongs to `jobs/dining-sync` consuming Feishu/Lark
OpenAPI records. The accepted catalog path is:

```text
Feishu/Lark campus/hall/stall/dish tables
-> catalog-observations
-> dining.source_observations(source_type=feishu_catalog)
-> publish-catalog OR publish-catalog-from-observations
-> dining catalog/release tables
-> latest published snapshot
```

The current publisher maps Feishu/Lark catalog rows to dining window
projections. Source tables do not carry formal floorplan geometry or SVG anchors,
so missing formal map assets must not block catalog publish. When no checked-in
floorplan scaffold exists, the publisher emits explicit placeholder floor/window
projection with deterministic geometry. Browser rendering may use the checked-in
manifest when present, or draw the placeholder projection from app-api response
geometry when the floorplan id is `placeholder:*`. Student UI must mark that map
state explicitly as "地图待补充" while still keeping the projected windows
selectable.

Publish must still fail closed for source relationship and projection integrity
errors: missing required display names, missing linked halls/stalls, orphaned
offerings or snapshot records that cannot be served must stay diagnostic instead
of being silently dropped.

The dev seed in `packages/domains/dining` is local/dev data. It can be imported
with `import-dev-seed` outside production, but it is not production dining
content truth. Floorplan scaffold is physical map structure only and does not
carry menu, price or review truth.

Production student-facing routes must read the DB-backed published snapshot
plus `dining.review_projections`, not in-memory fixture data. `apps/app-api` may
read and persist accepted operator edits through its PG adapter, but it must not
provide Feishu/Lark sync scripts or own catalog source truth.

Review production ownership belongs to `jobs/dining-sync`. That runtime consumes
Feishu/Lark OpenAPI review records, validates accepted rows, blocks unsafe
text/images through the dining moderation provider, materializes accepted
attachments to the public S3-compatible review prefix, lands
`feishu_review` observations, and writes `dining.review_projections` from
active accepted review observations.

## Operational Runbook

Repeatable launch and verification steps belong to
`docs/runbooks/dining-sync.md`. This data document only owns the logical schema
and data ownership rules that those steps operate on.
