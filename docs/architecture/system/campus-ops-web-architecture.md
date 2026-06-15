---
doc_type: architecture
truth_scope: product
owner_boundary: apps/campus-ops-web
status: active
created: 2026-06-08
updated: 2026-06-15
---
# Operator Console Operations Architecture

## 文档边界

本文冻结 Operator Console operations domain 的 supporting architecture，并记录当前
`apps/campus-ops-web` implementation surface。

它回答：

- 为什么 dining operations 属于统一 Operator Console，而不是第二个长期后台产品
- Worker shell 与 `app-api` proxy allowlist 如何分层
- dining workspace 第一批承载哪些能力
- 非 dining 后台域在当前阶段为什么只是 reserved route shell

它不负责：

- dining object schema，见 `docs/data/dining-operations-schema.md`
- dining HTTP contract，见 `docs/contracts/app-api-dining-ops-http.md`
- Operator Console observability query，见 `operator-observability-architecture.md`
- account / OAuth browser experience，见 identity browser architecture 文档

## Core Conclusion

Operator Console 是唯一长期受控 operator product concept。Dining operations 是其中一个
operations domain；当前实现由 `apps/campus-ops-web` 承载。

它不是：

- account browser shell 的隐藏扩展
- `protected-panel-web` 之外的第二个长期后台产品
- `campus-web` 的隐藏编辑模式
- generic internal-tools builder

长期 topology：

```text
operator browser
-> operator console dining workspace (current: campus-ops-web Worker)
-> explicit /api/ops/* proxy allowlist
-> app-api
-> domain-owned draft/release candidate/release/audit stores
```

## Runtime Boundary

当前 `campus-ops-web` implementation surface 使用 Worker shell：

- serve static assets
- expose `GET /healthz`
- proxy explicit `/api/ops/dining/*`
- reject unknown `/api/*`
- reject `/api/federation/*`
- does not proxy `/api/auth/*`

Auth/session truth stays in `app-api` / identity platform. The operations surface
only consumes operator admission results through proxied ops routes. It does not
own a second operator backend.

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

Dining is the only complete first-batch operations workspace target. Map,
feedback, knowledge, notices and services routes are placeholder shells to
reserve information architecture, not implemented editors or API commitments.

Current `campus-ops-web` implementation exposes the reserved route shell and the
primary dining workspace route set. `/dining/svg-demo` is not part of the
information architecture and must not be reintroduced.

## Dining Workspace

Accepted dining workspace contains:

- left hall/floor tree
- central read-only sanitized inline SVG floorplan preview from the repo
  floorplan manifest
- SVG anchor selection and binding
- right detail editor for stall assignment and menu price
- floorplan manifest metadata, anchor inventory and anchor binding validation
- release candidate creation, validation report, approval and scheduling
- published release list, release detail and rollback surface
- audit list

Current implemented dining workspace support includes hall/floor browsing,
sanitized inline SVG preview, draft window/assignment/menu/offering edits,
release candidate creation/validation/approval/scheduling/publish, release
list/detail/rollback and audit list routes. Future UI refinement may improve
density or navigation, but it must stay on these route and data boundaries.

Dining floorplans are repo-owned versioned static SVG assets. The workspace
does not upload/replace SVG, does not use Konva/react-konva as the primary
floorplan technology and does not include freeform floorplan shape editing.
MapLibre is reserved for outdoor map operations if map ops is later accepted.
If a floor SVG changes, the change ships through an application release and the
generated floorplan manifest, not through an operator upload control.

Current dining UI library choices are:

- `react-zoom-pan-pinch` for inline SVG pan/zoom controls
- `@tanstack/react-table` for the SVG anchor inventory
- `react-hook-form`, `@hookform/resolvers` and `zod` for the dining detail
  editor form

Dining publish UI is candidate-first:

```text
edit draft -> create candidate -> validate -> approve -> publish now / schedule
```

The workspace must not expose a control that publishes the mutable current draft
without a candidate. It may hide scheduling or rollback controls until the
underlying app-api routes are implemented, but the information architecture and
copy must not teach operators a direct-draft-publish model.

## Forbidden Shapes

- Do not embed operations workspace inside the account browser shell.
- Do not let `campus-web` call `/api/ops/*`.
- Do not expose generic `/api/*` proxy.
- Do not surface federation or auth management inside campus ops.
- Do not treat `campus-ops-web` as a second long-term operator product backend.
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
