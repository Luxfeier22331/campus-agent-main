---
doc_type: architecture
truth_scope: execution
owner_boundary: domains/dining
status: active
created: 2026-06-08
updated: 2026-07-13
---
# Dining Domain Architecture

## 文档边界

本文冻结 dining domain 的长期边界、owner 与 forbidden shapes。

它回答：

- dining floor/window/stall/menu truth 属于哪个领域
- draft、release candidate、release、published projection 如何分层
- `campus-web` 与 Operator Console dining workspace 分别消费什么
- Feishu/Lark 来源同步如何进入发布投影
- 问答链路如何只读消费食堂发布投影
- dining 与 navigation spatial truth 如何区分

它不负责：

- student public HTTP 字段，见 `docs/contracts/app-api/dining.md`
- ops HTTP 字段，见 `docs/contracts/app-api/dining-ops.md`
- logical schema 字段，见 `docs/data/dining.md`
- Operator Console operations surface，当前实现见
  `docs/architecture/system/operator-console.md`

## Core Conclusion

Dining domain owns dining hall/floor/window/stall/menu/release truth for the
student dining experience.

Primary read/write split:

```text
Feishu/Lark catalog source + manual collection
  -> jobs/dining-sync catalog-observations
  -> dining.source_observations(source_type=feishu_catalog)
  -> jobs/dining-sync publish-catalog OR publish-catalog-from-observations
  -> dining catalog/release tables

Feishu/Lark review source + manual collection
  -> jobs/dining-sync sync-all / CronJob
  -> shape validation + content moderation + attachment materialization
  -> dining.source_observations(source_type=feishu_review)
  -> dining.review_projections

campus-web -> app-api /api/dining/* -> latest published release snapshot

dining_lookup SDK function tool -> same published projection
```

`app-api` owns the HTTP reader/writer facade and Worker PG adapter. It does not
own dining catalog source truth, source sync, or Feishu/Lark access. It must
not call Feishu/Lark or shell out to `lark-cli` from online request handlers.

`packages/domains/dining` keeps repo-owned floorplan scaffold and a minimal
local/dev validation seed. Production catalog content comes from Feishu/Lark
source tables, enters `dining.source_observations`, then is published from
active PG observations. `publish-catalog` refreshes Feishu/Lark and publishes in
one command; `publish-catalog-from-observations` replays the already-landed PG
observations without accessing Feishu/Lark. The current publisher maps Feishu
catalog rows onto the existing repo floorplan scaffold when available because
Feishu does not provide SVG anchors or floorplan geometry.

Floorplan scaffold/SVG presence is not student visibility truth. A hall becomes
visible in `campus-web` only after it is present in the latest published dining
snapshot served by `app-api`. Local development must prove that path by running
shared-product schema baseline, importing the local dev seed, and checking the
published snapshot; checking only `@campus-agent/dining/floorplans` assets or
scaffold entries is insufficient.

## Domain Objects

Dining domain object family:

- hall
- floor
- window
- stall profile
- window assignment
- menu item
- menu offering
- source observation
- release candidate
- release validation report
- release
- release snapshot
- release latest pointer
- audit event

The domain intentionally separates physical window, stall assignment, and menu offering:

- a window is a physical floorplan object
- an assignment places a stall profile at a window
- a menu offering places item and display price reference under an assignment

This allows operators to update stall display data or price references without
rewriting physical space truth.

## Floorplan

Dining floorplans use repo-owned versioned SVG assets as the canonical visual
map for floor/window interaction. SVG is not dining business truth.

Canonical shape:

```text
repo SVG asset -> build-time SVG validation/sanitization
  -> generated floorplan manifest with sha256 and anchor inventory
  -> app-api / campus-web / operator console dining workspace
     consume the same manifest package
  -> release candidate frozen floorplan manifest reference
  -> release snapshot
campus-web / operator console dining workspace -> sanitized inline SVG renderer
```

SVG assets must expose stable anchors:

```xml
<g data-dining-role="window" data-dining-anchor-id="window-01">
  ...
</g>
```

`data-dining-anchor-id` is the visual map anchor. Dining business objects bind
to anchors in draft, release candidate and release snapshot data:

```text
windowId <-> svgAnchorId
```

The SVG may contain visual structure, labels, entrances, seating areas and
semantic roles. It must not contain menu, price, sale status, release status or
operator-only data.

Each accepted SVG has a generated manifest entry containing:

- `floorplanId`
- `hallId`
- `floorId`
- static asset path
- sanitized inline SVG markup or generated inline payload reference
- `sha256`
- extracted anchor inventory

`dining.*` does not own floorplan bytes and does not upload floorplan SVG to
object storage. A release candidate freezes the manifest reference, checksum,
anchor inventory and `windowId <-> svgAnchorId` bindings used by the candidate.
Publish writes the immutable dining snapshot and latest pointer; it does not
copy SVG objects or synthesize fixture SVG bytes.

`campus-web` and Operator Console dining workspace render the sanitized SVG
inline so they can select, highlight and center a specific anchor. Rendering SVG
through `<img>` is insufficient for anchor-level interaction because the page
cannot access the SVG DOM.

Implementation choices:

- `fast-xml-parser` owns build-time SVG parse/build and anchor extraction.
- dining-owned allowlist sanitizer owns the build-time security boundary.
- `svgo` is optional optimization only and must preserve `id` and
  `data-dining-*` attributes.
- `react-zoom-pan-pinch` owns inline SVG pan/zoom interaction.
- `@tanstack/react-table` owns the operator anchor inventory table behavior.
- `react-hook-form`, `@hookform/resolvers` and `zod` own operator form state
  and validation.
- Drawing/map libraries such as Konva, Fabric, D3 or MapLibre are not primary
  dining floorplan technology unless the product becomes an online drawing
  editor or navigation map.

## Release Lifecycle

Dining publish is candidate-first. A mutable draft is never directly published
as the long-term accepted shape.

```text
draft edit
-> release candidate
-> validation report
-> approval
-> publish now OR schedule publish
-> immutable release snapshot
-> latest pointer update
-> audit event
```

Release candidate creation freezes:

- `baseDraftVersion`
- floorplan manifest refs, checksums and extracted SVG anchor inventory
- `windowId <-> svgAnchorId` bindings
- candidate snapshot hash

Validation must fail closed for:

- missing required floorplan manifest entry
- missing, duplicate or unbound required SVG anchors
- stale candidate when draft version no longer matches `baseDraftVersion`
- missing stall profile, assignment, menu item or offering projection fields
- floorplan manifest checksum mismatch

Scheduled publish is a release candidate execution mode, not a cron publish of
the mutable current draft. A scheduler may publish only an approved candidate
whose validation report still passes and whose expected predecessor release
still matches. Failure does not update the latest published pointer.

Rollback does not mutate draft. It either moves the latest pointer back to a
historical published release or creates a new candidate from a historical
snapshot, depending on the accepted HTTP contract.

## Student Projection

Student-facing dining routes stay compact:

```http
GET /api/dining/halls
GET /api/dining/halls/:hallId/floors/:floorId
GET /api/dining/halls/:hallId/reviews
```

They return published hall summaries, floor projections and current read-only
review projection suitable for
`campus-web`:

- hall summary includes only campus, hall identity and map selector fields;
  it does not expose collection statistics, stall count, offering count, tag
  summaries or hall-level price ranges
- floor projection includes versioned floorplan metadata/markup, SVG anchors,
  windows, assignment, stall profile, offerings and API-provided filter tags
- 单地图食堂只使用一张地图投影，不展示学生端楼层切换；多地图食堂可以展示
  "一层" / "二层" 这类地图标签
- 海淀二食堂、海淀四食堂的学生端模型仍是两个食堂各自一张地图。参考图中
  "一层是四食堂、二层是二食堂" 只作为结构重建来源事实，不新增 building
  模型，也不要求学生端理解楼层关系
- window/stall is one student-facing "档口" concept; `svgAnchorId` is rendered
  as the primary floorplan selection anchor, not as navigation spatial truth
- offerings are nested under assignment, not physical window
- hall reviews read from `dining.review_projections`; review records bind to the
  current published `stallProfileId` and `windowId`, while preserving submitted
  stall and dish names as free text. Dish names do not bind to `menuItemId` or
  `offeringId`
- `campus-web` consumes hall reviews under the selected map stall and selected
  dish context; review cards show reviewer name, rating, paid price, comment
  and image preview entry points, and do not repeat stall or dish names already
  supplied by the parent context
- review images are served as local static assets and public API responses
  never expose Lark / Feishu file tokens
- inconsistent campus/hall submissions are not guessed into another hall

They do not expose:

- draft state
- audit event
- raw source observation
- operator id
- internal DB row metadata
- unpublished menu offering
- release candidate
- release id
- menu spec labels or sale status
- source remarks/notes, collection coverage metrics or hall-level price ranges
- Lark / Feishu file token, raw attachment URL or Base-only field metadata
- dish alias merge, ranking, likes, replies or review submission workflow

If no published release exists, the student route must return explicit empty or
typed not-found behavior. It must not silently fall back to in-memory fixture
data.
If a published snapshot is missing required floorplan, stall profile or menu item
projection fields, the route must fail closed rather than synthesize placeholder
food, price, geometry or tags.

## Source Sync Boundary

Dining source sync is an offline/runtime task, not an app-api request path.

Allowed shapes:

- local manual validation through `lark-cli` or `jobs/dining-sync`
- Docker manual sync for local runtime validation
- Kubernetes `Job` for manual rerun
- Kubernetes `CronJob` for scheduled production sync

Forbidden shapes:

- `app-api` online handler queries Feishu/Lark directly
- `app-api` online handler shells out to `lark-cli`
- app-api owns catalog source/import scripts or writes current dining business
  content as production truth
- frontend or model runtime consumes raw Feishu/Lark rows or file tokens

Production sync uses a project-specific Feishu/Lark application identity, not a
personal login token. The app must be granted the target Base and the minimum
Base/media read scopes documented in `docs/environment/providers.md`.

Default scheduling posture:

- production: hourly CronJob, `concurrencyPolicy: Forbid`,
  `timeZone: Asia/Shanghai`
- staging: same manifest shape, default suspended until explicit manual validation
- local: explicit manual commands only. For student-surface validation, run
  app-api shared product bootstrap first, then `jobs/dining-sync`
  `import-dev-seed` and `verify-published`; app-api must not own a
  dining-specific preparation script.

Catalog sync output must be deterministic and fail closed. Catalog publish and
dev seed import closeout must expose the visible hall/floor set so missing
published maps are visible before browser smoke. A catalog record is
publishable only after required source links and display fields validate.
Repeatable closeout steps and `verify-published` usage belong to
`docs/runbooks/dining-sync.md`.
Formal floorplan SVG completeness is not catalog admission. During the current
bootstrap stage, catalog rows with valid source relationships are published even
when the formal repo floorplan scaffold is incomplete:

- hall must have a campus link and display name
- stall/window must belong to an accepted hall and have a display name
- dish/menu offering must reference at least one accepted stall/window
- missing formal floorplan geometry produces explicit placeholder floor/window
  projection, not a blocked source observation

`campus-web` 对 placeholder floorplan 显示明确的“地图待补充”状态，同时仍使用
projection 中的 `windows[].geometry` 绘制可点击档口。该状态表示正式地图资产尚未补齐，
不是 app-api 兜底生成业务内容。

Rows that fail these checks are stored as blocked
`dining.source_observations` with deterministic `blockReason` values such as
`campus_not_found`, `hall_not_found`, `stall_not_found`, `stall_name_missing`
or `dish_name_missing`. They must not be silently accepted and then disappear
during publish.

Review records are publishable only after source shape validation, current
catalog stall/window resolution, content moderation and attachment
materialization all pass. Accepted and blocked review records are landed as
`dining.source_observations(source_type=feishu_review)`; only active accepted
review observations are materialized into `dining.review_projections`.

Catalog tables currently required from Feishu/Lark Base:

- campus table: campus display name and sort order
- hall table: hall display name, campus link and sort order
- stall table: stall/window display name, hall link, sort order and tags
- dish table: dish display name, stall links, optional display price and tags

`menu_offerings.price_label` is nullable. Missing price is a known source fact,
not a frontend error; student UI hides the price chip rather than inventing a
placeholder.

`jobs/dining-sync` owns content moderation through an OpenAI-compatible Gitee AI
moderation endpoint configured by `DINING_MODERATION_*`. Text review fields
(`dishName`, `stallName`, `contributorName`, `comment`) are checked by
`Security-semantic-filtering` by default. Downloaded review images are first
written to a non-projected moderation object prefix, checked by
`nsfw-classifier` through a provider-fetchable HTTPS object URL, then copied to
the public review image prefix only after passing moderation. The paid
`moark-text-moderation` model may be selected through env override when the free
text gate is not good enough. `nonescape-v0` is not a dining safety moderation
model and must not be used as the default review image gate. Deterministic
record-level moderation results such as flagged or uncertain text, or image
moderation rejection, block that source record and keep the rest of the batch
processing. Provider HTTP errors, invalid provider responses, missing config,
object-store failures or DB failures are runtime failures and must fail closed
for the whole sync run.
These models are content moderation gates for Feishu/Lark review records and
attachments; they are not retrieval embedding models and must not enter app-api
online provider-config or model-visible tool catalogs.

## Tool Consumption Boundary

The model-visible food tool target should be a read-only SDK function tool such as
`dining_lookup`.

It may read:

- latest published dining projection
- public review projection fields
- public image URLs

It must not read:

- Feishu/Lark Base tables
- raw `record-list` JSON
- Feishu/Lark file tokens or temporary download URLs
- app-api-owned dev seed state as source truth
- navigation graph, service status or live opening exceptions

Questions that require current time, opening status or temporary closure must
compose with a separate service-status tool. Dining must not absorb that source
truth.

## Ops Projection

Ops routes expose draft objects to authorized operator principals only:

```http
/api/ops/dining/*
```

Ops routes are command/query surfaces for Operator Console dining workspace,
not general browser APIs. They must remain out of `campus-web` and retired
launcher surfaces. The current implementation surface is `apps/operator-console-web`.

## Source Observation Boundary

Source observation is now the implemented landing zone for Feishu/Lark catalog
facts. It remains an offline data-plane boundary and is not exposed through
student or operator HTTP routes in the current scope.

Implemented catalog path:

```text
Feishu/Lark catalog tables
-> jobs/dining-sync catalog-observations
-> dining.source_observations(source_type=feishu_catalog)
-> jobs/dining-sync publish-catalog OR publish-catalog-from-observations
-> published dining release snapshot
```

Implemented review path:

```text
Feishu/Lark review table
-> jobs/dining-sync sync-all
-> shape validation + current catalog resolver
-> content moderation + S3-compatible attachment materialization
-> dining.source_observations(source_type=feishu_review)
-> dining.review_projections
```

`dining.source_observations` is an idempotent PG landing table for catalog and
review observations. Sync uses
`observation_id` upsert and marks observations missing from the newest run as
stale instead of deleting rows. Publishing consumes active observations
(`stale_at IS NULL`) only. Raw Feishu/Lark catalog/review archives are not
written to object storage in the current scope; object storage is used for
review image attachment materialization.

Observation rows do not become student-visible data by themselves. Only the
publish job may materialize accepted catalog observations into catalog tables
and the latest published release snapshot. The current implementation does not
expose observation listing, apply or reject routes.

Operator review/apply workflows are not owned by this active architecture until
an explicit product requirement and operations contract accepts them.

## Navigation Boundary

Dining floorplan geometry is not navigation spatial truth.

Allowed relationship:

- dining hall can reference a campus place/facility
- dining floor/window can be shown inside dining UI
- navigation can route to a dining hall or entrance using navigation spatial truth

Forbidden relationship:

- do not use dining window geometry as campus route graph
- do not let navigation agent own menu/pricing truth
- do not let dining publish alter campus place catalog without a navigation
  domain contract

## Current Catalog Scope

The current catalog scope is the Feishu/Lark Base dining collection mapped onto
the repo-owned floorplan scaffold:

- campus, hall, stall/window and dish rows come from Feishu/Lark catalog tables
- price is optional and remains a display label when present
- hall/floor SVG anchors come from repo-owned floorplan assets
- source rows that map to a known floorplan scaffold use repo-owned window
  anchors; rows without a formal scaffold use explicit placeholder floor/window
  projection instead of blocking catalog publish
- unmapped or inconsistent source links are blocked instead of guessed

The dev seed in `packages/domains/dining` is not production source truth. It
remains useful for local development and initializing a dev database before
Feishu sync is configured. Floorplan scaffold remains map structure only and
must not carry menu, price or review truth.

## Non-Goals

Dining product scope does not include the following in the accepted domain
boundary:

- merchant self-service
- real-time queue or live opening status
- menu portion/spec labels or sale status
- payment/order integration
