---
doc_type: architecture
status: active
created: 2026-06-08
updated: 2026-06-08
---
# Dining Domain Architecture

## 文档边界

本文冻结 dining domain 的长期边界、owner 与 forbidden shapes。

它回答：

- dining floor/window/stall/menu truth 属于哪个领域
- draft、release、published projection 如何分层
- `campus-web` 与 `campus-ops-web` 分别消费什么
- dining 与 navigation spatial truth 如何区分

它不负责：

- student public HTTP 字段，见 `docs/contracts/app-api-dining-http.md`
- ops HTTP 字段，见 `docs/contracts/app-api-dining-ops-http.md`
- logical schema 字段，见 `docs/data/dining-operations-schema.md`
- `campus-ops-web` Worker shell，见
  `docs/architecture/system/campus-ops-web-architecture.md`

## Core Conclusion

Dining domain owns dining hall/floor/window/stall/menu/release truth for the
student dining experience.

Primary read/write split:

```text
campus-ops-web -> app-api /api/ops/dining/* -> dining draft -> release snapshot
campus-web -> app-api /api/dining/* -> latest published release snapshot
```

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
- release
- release snapshot
- audit event

The domain intentionally separates physical window, stall assignment, and menu offering:

- a window is a physical floorplan object
- an assignment places a stall profile at a window
- a menu offering places item/price/status under an assignment

This allows operators to change a stall, move a menu, or update a price without
rewriting physical space truth.

## Student Projection

Student-facing dining routes stay compact:

```http
GET /api/dining/halls
GET /api/dining/halls/:hallId/floors/:floorId
```

They return published hall summaries and floor projections suitable for
`campus-web`:

- hall summary includes campus, floors, stall count, offering count, tags and
  price range label
- floor projection includes SVG asset URL, canvas, windows, assignment, stall
  profile, offerings and API-provided filter tags
- window geometry is rendered as student-facing floorplan overlay, not as
  navigation spatial truth
- offerings are nested under assignment, not physical window

They do not expose:

- draft state
- audit event
- raw source observation
- operator id
- internal DB row metadata
- unpublished menu offering

If no published release exists, the student route must return explicit empty or
typed not-found behavior. It must not silently fall back to in-memory seed data.
If a published snapshot is missing required floorplan, stall profile or menu item
projection fields, the route must fail closed rather than synthesize placeholder
food, price, geometry or tags.

## Ops Projection

Ops routes expose draft objects to authorized operator principals only:

```http
/api/ops/dining/*
```

Ops routes are command/query surfaces for `campus-ops-web`, not general browser
APIs. They must remain out of `campus-web` and retired launcher surfaces.

## Source Observation

Source observation is a future input path for crawled, uploaded, or manually
observed dining facts.

Observation lifecycle:

```text
observation captured
-> pending review
-> apply to draft OR reject
-> audit
-> optional publish
```

Observation does not become student-visible data until a release is explicitly published.

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

## Current Initial Scope

The initial release covers:

- 海淀校区 1-5 食堂，每个单层
- 丰台校区 汇贤、聚雅，每个两层
- 每层至少 5 个窗口
- 部分窗口包含多个 offering，用于验证一个档口多个菜品/价格的学生端与 ops 端体验

This is a seeded initial release, not a claim that all real dining data
collection is complete.

Initial release seed ownership lives in the dining operations domain, not
`campus-experience`. `campus-experience` keeps map and feedback ownership and
does not own dining floorplan/menu seed data.

## Non-Goals

First batch does not include:

- merchant self-service
- real-time queue or opening status
- payment/order integration
- automatic source observation apply
- dining data quality evaluation pipeline
