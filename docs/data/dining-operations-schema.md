---
doc_type: data
truth_scope: data
owner_boundary: apps/app-api
status: active
created: 2026-06-08
updated: 2026-06-14
---
# Dining Operations Schema

## 文档边界

本文冻结 `dining.*` app-owned logical schema、ownership 与数据面边界。

它回答：

- dining operations 中哪些对象是 draft truth
- release candidate 如何冻结 draft version 并进入发布控制面
- release snapshot 如何成为学生端 published projection truth
- source observation 与 draft/published 的关系
- audit event 记录什么

它不负责：

- app-api HTTP shape，见 `docs/contracts/app-api-dining-ops-http.md`
- student public dining HTTP shape，见 `docs/contracts/app-api-dining-http.md`
- campus ops web UI，见 `docs/architecture/system/campus-ops-web-architecture.md`
- navigation spatial truth，见 `docs/architecture/domains/navigation/architecture.md`

## Ownership

`apps/app-api` owns `dining.*`。

`apps/campus-ops-web` consumes ops routes and does not own storage truth.
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
- `dining.source_observations`
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

Offer of a menu item at a window assignment with price and sale status.

Canonical fields:

- `offering_id`
- `assignment_id`
- `menu_item_id`
- `price_label`
- `spec_label`
- `sale_status`
- `created_at`
- `updated_at`

Rules:

- `price_label` is display text, not numeric pricing truth
- real-time availability and queue state are not in scope

### `dining.source_observations`

Reserved source observation/proposal table. The table documents the storage
boundary for possible collected or manually observed facts, but current route
surface does not implement observation list/apply/reject commands.

Canonical fields:

- `observation_id`
- `source_type`
- `target_kind`
- `target_id`
- `payload_json`
- `status`
- `observed_at`
- `reviewed_at`
- `reviewed_by`

Rules:

- observation does not mutate draft by itself
- observation cannot directly update published snapshot
- apply/reject, if accepted in a later scope, must be explicit operator command

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
  seed data
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

## Initial Release

The initial release materializes existing dining seed projection into
`dining.*`, validates repo-owned floorplan manifest entries and publishes
`dining_release:initial`.

Initial scope:

- 海淀校区：1-5 食堂，每个单层
- 丰台校区：荟贤、聚雅，每个两层
- 每层至少 5 个窗口
- 每个窗口至少 1 个 offering；部分窗口包含 2-3 个 offering

After materialization, production student-facing routes must read the DB-backed
published snapshot, not in-memory seed data. The repo floorplan manifest must be
available to app-api and browser apps before candidates can freeze floorplan
refs. Publish must fail closed when a candidate references a missing manifest
entry or checksum mismatch; it must not synthesize SVG markup during publish.

Initial seed ownership belongs to `apps/app-api/src/modules/dining-ops`, not
`campus-experience`. `campus-experience` remains responsible for map and
feedback product projections only.
