---
doc_type: architecture
status: active
created: 2026-06-08
updated: 2026-06-12
---
# Campus Ops Web Architecture

## 文档边界

本文冻结 `apps/campus-ops-web` 的 supporting architecture。

它回答：

- 为什么运营工作台是独立 app
- Worker shell 与 `app-api` proxy allowlist 如何分层
- dining workspace 第一批承载哪些能力
- 非 dining 后台域在当前阶段为什么只是 reserved route shell

它不负责：

- dining object schema，见 `docs/data/dining-operations-schema.md`
- dining HTTP contract，见 `docs/contracts/app-api-dining-ops-http.md`
- protected panel observability query，见 `operator-observability-architecture.md`
- account / OAuth browser experience，见 identity browser architecture 文档

## Core Conclusion

`apps/campus-ops-web` 是 Campus Operations Control Plane 的 operator workspace。

它不是：

- account browser shell 的隐藏扩展
- `protected-panel-web` 的 observability tab
- `campus-web` 的隐藏编辑模式

长期 topology：

```text
operator browser
-> campus-ops-web Worker
-> explicit /api/ops/* proxy allowlist
-> app-api
-> domain-owned draft/release candidate/release/audit stores
```

## Runtime Boundary

`campus-ops-web` 使用 Worker shell：

- serve static assets
- expose `GET /healthz`
- proxy explicit `/api/ops/dining/*`
- reject unknown `/api/*`
- reject `/api/federation/*`
- does not proxy `/api/auth/*`

Auth/session truth stays in `app-api` / identity platform. The ops web surface
only consumes operator admission results through proxied ops routes.

## Information Architecture

Accepted target routes:

- `/`
- `/dining`
- `/dining/:hallId/:floorId`
- `/dining/assets`
- `/dining/candidates`
- `/dining/candidates/:candidateId`
- `/dining/releases`
- `/dining/releases/:releaseId`
- `/dining/audit`
- `/map`
- `/feedback`
- `/knowledge`
- `/notices`
- `/services`

Dining is the only complete first-batch workspace target. Map, feedback,
knowledge, notices and services routes are placeholder shells to reserve the
backend modification surface information architecture, not implemented editors
or API commitments.

Current implementation exposes the reserved route shell and the primary dining
workspace route set. `/dining/svg-demo` is not part of the information
architecture and must not be reintroduced.

## Dining Workspace

Accepted dining workspace contains:

- left hall/floor tree
- central sanitized inline SVG floorplan preview
- SVG anchor selection and binding
- right detail editor for stall assignment and menu price
- floorplan asset upload/replace, anchor extraction and anchor diff surfaces
- release candidate creation, validation report, approval and scheduling
- published release list, release detail and rollback surface
- audit list

Current implemented dining workspace support includes hall/floor browsing,
sanitized inline SVG preview, SVG upload through
`POST /api/ops/dining/floorplan-assets`, draft window/assignment/menu/offering
edits, release candidate creation/validation/approval/scheduling/publish,
release list/detail/rollback and audit list routes. Future UI refinement may
improve density or navigation, but it must stay on these route and data
boundaries.

Dining floorplans use SVG upload/replace plus anchor binding. The workspace
does not use Konva/react-konva as the primary floorplan technology and does not
include freeform floorplan shape editing. MapLibre is reserved for outdoor map
operations if map ops is later accepted.

Dining publish UI is candidate-first:

```text
edit draft -> create candidate -> validate -> approve -> publish now / schedule
```

The workspace must not expose a control that publishes the mutable current draft
without a candidate. It may hide scheduling or rollback controls until the
underlying app-api routes are implemented, but the information architecture and
copy must not teach operators a direct-draft-publish model.

## Forbidden Shapes

- Do not embed ops workspace inside the account browser shell.
- Do not let `campus-web` call `/api/ops/*`.
- Do not expose generic `/api/*` proxy.
- Do not surface federation or auth management inside campus ops.
- Do not let source observations mutate published projections without explicit
  review and release.
- Do not expose "publish current draft" as the target dining publish workflow.
- Do not let a scheduled job publish mutable draft state; scheduled publish must
  target an approved release candidate.

## Staging Surface

Staging route target is `https://ops-staging.mucwiki-edge.link`.

Staging acceptance for dining requires:

- unauthorized user cannot access ops API
- operator can edit draft
- operator can create a release candidate from draft
- operator can inspect validation blockers and approve a valid candidate
- operator can publish an approved candidate and see the published release
- `campus-web` reads updated published `/api/dining/*`
- audit list shows editor/publisher action
