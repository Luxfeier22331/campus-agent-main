---
doc_type: decision
truth_scope: repository
owner_boundary: docs/decisions
decision_id: ADR-0049
status: accepted
created: 2026-06-08
updated: 2026-06-14
---
# ADR-0049 Campus Ops Control Plane

## 状态

Accepted on 2026-06-08.

ADR-0055 supersedes this ADR's separate long-term `campus-ops-web` product
surface decision. The `apps/campus-ops-web` implementation package has retired;
dining draft/candidate/release/audit lifecycle and domain boundaries in this ADR
continue to apply under `apps/operator-console-web`.

## 背景

`campus-web` 已经把学生侧校园体验面扩展到地图、食堂与反馈入口。食堂地图最初由
`app-api` 内 seed projection 支撑，用于验证学生端信息架构和交互效果。这个 seed 只能作为
initial release 输入，不能继续承担长期线上运营真相。

食堂窗口、档口、菜品与价格会持续变化。后续采集或人工观测也只能先进入 review/proposal，
不能直接覆盖学生端 published projection。把这些编辑能力塞进 account browser shell 会污染账号
边界。ADR-0055 已将长期后台概念统一为 Operator Console；因此 dining operations 不再被解释成
第二个长期后台产品，而是 Operator Console 内的受控 operations domain。

## 决策

Dining operations 是 Operator Console 内的受控 operations domain。当前 active
implementation 由 `apps/operator-console-web` 承载 dining workspace 与
`/api/ops/dining/*` proxy allowlist。

`apps/app-api` 拥有 dining operations 的写入、draft、release candidate、release、audit
与学生端 published projection。`apps/campus-web` 只读取 published projection，不读取 draft
或 release candidate，不提供编辑入口。

长期 shape 固定为：

```text
operator browser
-> operator console dining workspace (current: operator-console-web)
-> app-api /api/ops/dining/*
-> dining draft tables
-> release candidate / validation / approval / schedule / publish routes
-> immutable release snapshot
-> campus-web public /api/dining/* projection
```

## 决策细节

### 1. Dining operations 是 Operator Console domain

Operator Console 的 dining operations domain 负责：

- operator workspace shell
- dining hall / floor tree
- indoor floor window selection
- read-only repo-versioned floorplan SVG preview and anchor inventory
- window, assignment, menu item, menu offering forms
- release candidate validation, approval, scheduling and publish surfaces
- published release list and rollback surface
- audit list presentation

当前实现包 `apps/operator-console-web` 不负责：

- auth/session truth
- student-facing published projection truth
- app-api schema ownership
- SVG upload/replace for ordinary operators
- source observation direct application without review
- account browser / OAuth responsibilities

### 2. Draft 与 Published Snapshot 分离

Dining operations 按以下对象分层：

- physical space truth：hall、floor、window
- assignment truth：window assignment -> stall profile
- menu truth：menu item、menu offering
- release candidate truth：candidate metadata、validation report、approval、schedule
- release truth：published release metadata、immutable snapshot、latest pointer
- audit truth：operator action event

Operator edits mutate draft objects. Publish does not directly consume mutable
draft. Operators must first create a release candidate from a specific draft
version. Validation, approval, optional scheduling and publish all attach to that
candidate. Student-facing routes read only the latest published snapshot. No
query-time fallback to seed data, raw source observation, release candidate or
draft tables is allowed.

Directly publishing "whatever the current draft is" is not an accepted shape.
The current route inventory is candidate-first and must not reintroduce direct
draft publish routes.

### 3. Release Candidate 是完整发布控制面

Dining release lifecycle is:

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

Release candidates freeze:

- `base_draft_version`
- repo floorplan manifest id, static asset path, checksum and anchor inventory
- `window_id <-> svg_anchor_id` bindings
- validation blockers and warnings
- publish mode, schedule and approval metadata

Publish writes the immutable dining snapshot and latest pointer using frozen
floorplan manifest refs. It does not copy SVG objects into object storage and
does not synthesize SVG bytes. Initial dining seed bootstrap must validate the
repo floorplan manifest before publishing `dining_release:initial`.

Scheduled publish is allowed only for approved release candidates. A cron or
workflow job must never publish the mutable current draft. If the candidate is
stale, validation blockers exist, a floorplan manifest checksum mismatches, or
the expected predecessor release no longer matches, publish fails closed and
latest published remains unchanged.

Rollback does not rewrite draft. It either moves the latest pointer to a
previous published release or creates a new candidate from a historical snapshot,
depending on the concrete HTTP contract accepted for the rollout.

### 4. Source Observation 是保留边界，不是当前 route surface

`dining.source_observations` 保留为 proposal/review storage boundary，不进入当前计划开发周期的
implemented route surface。

Source observation 不得直接写入 draft 或 published projection。它必须经过 operator
review；如果后续 scope 接受 apply/reject command，它也只能进入 draft 或终止，不能直接发布。

### 5. Dining Truth 不等于 Navigation Spatial Truth

Dining floor/window truth 描述食堂内部楼层图、窗口区域、档口和菜单价格。
Navigation spatial truth 描述校园建筑、道路、入口、路线与可达性。两者可以通过
place/facility ref 关联，但不能互相替代。

`dining.windows.geometry_json` 是 indoor floorplan editor geometry，不是 route
graph truth。

## 结果

- dining operations 作为 Operator Console domain 落在当前 `apps/operator-console-web`
  实现上。
- `docs/contracts/app-api-operator-ops-http.md` 冻结 ops cross-cutting contract。
- `docs/contracts/app-api-dining-ops-http.md` 冻结 dining ops HTTP contract。
- `docs/data/dining-operations-schema.md` 冻结 dining operations logical schema。
- `docs/architecture/system/operator-console-operations-architecture.md` 冻结当前实现的
  web surface boundary。
- `docs/architecture/domains/dining/architecture.md` 冻结 dining domain boundary。

## 非目标

以下不进入当前计划开发周期的 operator ops / dining 产品范围：

- 商户自助后台
- 实时排队、营业状态、支付或订单系统
- 采集自动覆盖线上数据

`dining.windows.status` 与 `dining.menu_offerings.sale_status` 只表示人工维护后发布的
食堂展示投影，不表示实时营业、库存、排队、商户经营状态或订单状态。

本 ADR 也不决定：

- map/feedback 完整运营模块
- MediaWiki、browser account shell 或 OAuth federation 行为
