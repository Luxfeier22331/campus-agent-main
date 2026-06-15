---
doc_type: architecture
truth_scope: capability
owner_boundary: domains/dining
status: active
created: 2026-06-08
updated: 2026-06-14
---
# Dining Domain Architecture

## 文档边界

本文冻结 dining domain 的长期边界、owner 与 forbidden shapes。

它回答：

- dining floor/window/stall/menu truth 属于哪个领域
- draft、release candidate、release、published projection 如何分层
- `campus-web` 与 Operator Console dining workspace 分别消费什么
- dining 与 navigation spatial truth 如何区分

它不负责：

- student public HTTP 字段，见 `docs/contracts/app-api-dining-http.md`
- ops HTTP 字段，见 `docs/contracts/app-api-dining-ops-http.md`
- logical schema 字段，见 `docs/data/dining-operations-schema.md`
- Operator Console operations surface，当前实现见
  `docs/architecture/system/campus-ops-web-architecture.md`

## Core Conclusion

Dining domain owns dining hall/floor/window/stall/menu/release truth for the
student dining experience.

Primary read/write split:

```text
Operator Console dining workspace (current: campus-ops-web)
  -> app-api /api/ops/dining/* -> dining draft
  -> release candidate -> published release snapshot
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
- release candidate
- release validation report
- release
- release snapshot
- release latest pointer
- audit event

The domain intentionally separates physical window, stall assignment, and menu offering:

- a window is a physical floorplan object
- an assignment places a stall profile at a window
- a menu offering places item/price/status under an assignment

This allows operators to change a stall, move a menu, or update a price without
rewriting physical space truth.

## Floorplan SVG Architecture

Dining floorplans use SVG as the canonical visual map asset for floor/window
interaction. The SVG is not the dining business truth source.

The intended technology shape is:

```text
repo SVG asset -> build-time SVG validation/sanitization
  -> generated floorplan manifest with sha256 and anchor inventory
  -> app-api / campus-web / operator console dining workspace
     consume the same manifest package
  -> release candidate frozen floorplan manifest reference
  -> release snapshot
campus-web / operator console dining workspace -> sanitized inline SVG renderer
```

Library choices:

- `fast-xml-parser` is the build-time SVG XML parser/builder for validation,
  safe SVG reconstruction and anchor extraction.
- The sanitizer is dining-owned allowlist logic executed before a static
  floorplan enters the manifest. Generic SVG optimizers or browser DOM
  sanitizers do not define the security boundary.
- `svgo` is optional optimization only. It must preserve `id` and
  `data-dining-*` attributes if introduced.
- `react-zoom-pan-pinch` is the React viewport interaction library for
  student-facing and operator-facing inline SVG pan/zoom. It does not own SVG
  validation, sanitization, anchor extraction or dining data.
- `@tanstack/react-table` owns the operator anchor inventory table behavior.
- `react-hook-form`, `@hookform/resolvers` and `zod` own the operator detail
  editor form state and validation.
- `konva`, `react-konva`, `fabric`, `d3` and map/navigation frameworks are not
  the primary dining floorplan technology. They are only appropriate if the
  product explicitly becomes an online drawing editor or a navigation map.

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
semantic roles. It must not contain menu, price, curated sale status, release
status or operator-only data.

SVG floorplans are repo-owned versioned static assets. A floorplan replacement
is an application release, not an operator draft edit. Each accepted SVG has a
generated manifest entry containing:

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
copy SVG objects or synthesize seed SVG bytes.

`campus-web` and Operator Console dining workspace render the sanitized SVG
inline so they can select, highlight and center a specific anchor. Rendering SVG
through `<img>` is insufficient for anchor-level interaction because the page
cannot access the SVG DOM.

Operator Console dining workspace is a floorplan-backed dining data workspace.
The current implementation surface is `apps/campus-ops-web`:

- render the repo-versioned floor SVG as read-only structure
- list manifest anchors
- preview sanitized inline SVG
- select an anchor by clicking the SVG
- bind the anchor to a dining window
- edit window, stall profile, menu item and menu offering draft data
- create release candidates from a specific draft version
- show validation blockers and warnings before approval
- approve, publish now, schedule publish, cancel candidate and inspect release
  history
- block candidate publish when required window bindings reference missing or
  duplicate anchors

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
```

They return published hall summaries and floor projections suitable for
`campus-web`:

- hall summary includes campus, floors, stall count, offering count, tags and
  price range label
- floor projection includes versioned floorplan metadata/markup, SVG anchors, windows,
  assignment, stall profile, offerings and API-provided filter tags
- window `svgAnchorId` is rendered as student-facing floorplan selection, not
  as navigation spatial truth
- offerings are nested under assignment, not physical window

They do not expose:

- draft state
- audit event
- raw source observation
- operator id
- internal DB row metadata
- unpublished menu offering
- release candidate

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

Ops routes are command/query surfaces for Operator Console dining workspace,
not general browser APIs. They must remain out of `campus-web` and retired
launcher surfaces. The current implementation surface is `apps/campus-ops-web`.

## Source Observation Boundary

Source observation is a reserved proposal/input boundary for crawled, uploaded,
or manually observed dining facts. It is not part of the current implemented
route surface.

Observation lifecycle:

```text
observation captured
-> pending review
-> apply to draft OR reject
-> audit
-> optional publish
```

Observation does not become student-visible data until a review/apply command
exists and a release is explicitly published. The current worktree does not
implement observation listing, apply, or reject routes.

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
- 丰台校区 荟贤、聚雅，每个两层
- 每层至少 5 个窗口
- 部分窗口包含多个 offering，用于验证一个档口多个菜品/价格的学生端与 ops 端体验

This is a seeded initial release, not a claim that all real dining data
collection is complete.

Initial release seed ownership lives in the dining operations domain, not
`campus-experience`. `campus-experience` keeps map and feedback ownership and
does not own dining floorplan/menu seed data.

## Non-Goals

Dining product scope does not include the following during the current planned
development cycle:

- merchant self-service
- real-time queue or live opening status
- payment/order integration

`window.status` and `offering.saleStatus` are curated projection fields for the
published dining view; they are not live shop operation, queue, inventory or
opening-state signals.

Current worktree scope also does not include:

- automatic source observation apply
- dining data quality evaluation pipeline
