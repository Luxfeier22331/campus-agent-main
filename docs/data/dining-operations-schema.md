---
doc_type: data
status: active
created: 2026-06-08
updated: 2026-06-08
---
# Dining Operations Schema

## 文档边界

本文冻结 `dining.*` app-owned logical schema、ownership 与数据面边界。

它回答：

- dining operations 中哪些对象是 draft truth
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

Current logical tables:

- `dining.halls`
- `dining.floors`
- `dining.windows`
- `dining.window_assignments`
- `dining.stall_profiles`
- `dining.menu_items`
- `dining.menu_offerings`
- `dining.source_observations`
- `dining.releases`
- `dining.release_snapshots`
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

Hall floor identity and floorplan asset relation.

Canonical fields:

- `floor_id`
- `hall_id`
- `label`
- `svg_asset_url`
- `sanitized_svg_markup`
- `sort_key`
- `created_at`
- `updated_at`

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

- `svg_anchor_id` binds the window to a sanitized floor SVG
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

### `dining.releases`

Release metadata.

Canonical fields:

- `release_id`
- `notes`
- `status`
- `published`
- `published_at`
- `published_by`
- `created_at`
- `created_by`

### `dining.release_snapshots`

Immutable published payload for student-facing dining projection.

Canonical fields:

- `snapshot_id`
- `release_id`
- `payload_json`
- `created_at`

Rules:

- student `/api/dining/*` reads latest published snapshot
- snapshots are not recomputed from draft at query time
- missing published release yields empty/typed not-found behavior, not fallback
  seed data
- student projection uses window -> assignment -> stall profile -> menu offering
  -> menu item relations captured inside the snapshot
- snapshot payload must include sanitized SVG floorplan data and SVG anchor
  bindings for any student-visible floor
- missing floorplan, stall profile or menu item projection data is a data
  integrity error; readers must fail closed rather than synthesize placeholder
  SVG anchors, food names, prices or tags

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
`dining.*` and publishes `dining_release:initial`.

Initial scope:

- 海淀校区：1-5 食堂，每个单层
- 丰台校区：荟贤、聚雅，每个两层
- 每层至少 5 个窗口
- 每个窗口至少 1 个 offering；部分窗口包含 2-3 个 offering

After materialization, production student-facing routes must read the DB-backed
published snapshot, not in-memory seed data.

Initial seed ownership belongs to `apps/app-api/src/modules/dining-ops`, not
`campus-experience`. `campus-experience` remains responsible for map and
feedback product projections only.
