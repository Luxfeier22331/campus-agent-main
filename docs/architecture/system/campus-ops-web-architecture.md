---
doc_type: architecture
status: active
created: 2026-06-08
updated: 2026-06-08
---
# Campus Ops Web Architecture

## 文档边界

本文冻结 `apps/campus-ops-web` 的 supporting architecture。

它回答：

- 为什么运营工作台是独立 app
- Worker shell 与 `app-api` proxy allowlist 如何分层
- dining workspace 第一批承载哪些能力
- map/feedback 在第一批为什么只是 future module shell

它不负责：

- dining object schema，见 `docs/data/dining-operations-schema.md`
- dining HTTP contract，见 `docs/contracts/app-api-dining-ops-http.md`
- protected panel observability query，见 `operator-observability-architecture.md`
- Hub account / launcher / OAuth，见 identity 与 hub architecture 文档

## Core Conclusion

`apps/campus-ops-web` 是 Campus Operations Control Plane 的 operator workspace。

它不是：

- `hub-web` 的账号中心扩展
- `protected-panel-web` 的 observability tab
- `campus-web` 的隐藏编辑模式

长期 topology：

```text
operator browser
-> campus-ops-web Worker
-> explicit /api/ops/* proxy allowlist
-> app-api
-> domain-owned draft/release/audit stores
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

First batch routes:

- `/`
- `/dining`
- `/dining/:hallId/:floorId`
- `/dining/releases`
- `/dining/audit`
- `/map`
- `/feedback`

Dining is the only complete first-batch workspace. Map and feedback routes are
placeholder shells to reserve product navigation, not implemented editors.

## Dining Workspace

First batch dining workspace contains:

- left hall/floor tree
- central floorplan canvas
- window selection
- right detail editor for stall assignment and menu price
- release list
- audit list

Konva/react-konva is used for indoor floorplan window selection and future
shape editing. MapLibre is reserved for outdoor map operations when map ops
matures.

## Forbidden Shapes

- Do not embed ops workspace inside `hub-web`.
- Do not let `campus-web` call `/api/ops/*`.
- Do not expose generic `/api/*` proxy.
- Do not surface federation or auth management inside campus ops.
- Do not let source observations mutate published projections without explicit
  review and release.

## Staging Surface

Staging route target is `https://ops-staging.mucwiki-edge.link`.

Staging acceptance for dining requires:

- unauthorized user cannot access ops API
- operator can edit draft
- operator can publish release
- `campus-web` reads updated published `/api/dining/*`
- audit list shows editor/publisher action
