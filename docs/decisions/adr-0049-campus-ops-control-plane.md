---
doc_type: decision
decision_id: ADR-0049
status: accepted
created: 2026-06-08
updated: 2026-06-09
---
# ADR-0049 Campus Ops Control Plane

## 状态

Accepted on 2026-06-08.

## 背景

`campus-web` 已经把学生侧校园体验面扩展到地图、食堂与反馈入口。食堂地图最初由
`app-api` 内 seed projection 支撑，用于验证学生端信息架构和交互效果。这个 seed 只能作为
initial release 输入，不能继续承担长期线上运营真相。

食堂窗口、档口、菜品与价格会持续变化。后续采集或人工观测也只能先进入 review/proposal，
不能直接覆盖学生端 published projection。把这些编辑能力塞进 account browser shell 会污染账号
边界；放进 `protected-panel-web` 会把 observability/panel 查询面扩成运营工作台。两者都不是长期正确
owner。

## 决策

新增 `apps/campus-ops-web` 作为 Campus Operations Control Plane 的 operator workspace。

`apps/app-api` 拥有 dining operations 的写入、draft、release、audit 与学生端 published
projection。`apps/campus-web` 只读取 published projection，不读取 draft，不提供编辑入口。

长期 shape 固定为：

```text
operator browser
-> campus-ops-web
-> app-api /api/ops/dining/*
-> dining draft tables
-> release preview / publish
-> immutable release snapshot
-> campus-web public /api/dining/* projection
```

## 决策细节

### 1. `campus-ops-web` 是运营面 owner

`campus-ops-web` 负责：

- operator workspace shell
- dining hall / floor tree
- indoor floor window selection
- window, assignment, menu item, menu offering forms
- release preview / publish action surface
- audit list presentation

`campus-ops-web` 不负责：

- auth/session truth
- student-facing published projection truth
- app-api schema ownership
- source observation direct application without review
- account browser / OAuth responsibilities

### 2. Draft 与 Published Snapshot 分离

Dining operations 按以下对象分层：

- physical space truth：hall、floor、window
- assignment truth：window assignment -> stall profile
- menu truth：menu item、menu offering
- release truth：release metadata、immutable snapshot
- audit truth：operator action event

Operator edits mutate draft objects. Student-facing routes read only the latest
published snapshot. No query-time fallback to seed data, raw source observation,
or draft tables is allowed.

### 3. Source Observation 只能进入 proposal/review

未来采集到的摊位、菜品或价格观测写入 `dining.source_observations`。

Source observation 不得直接写入 draft 或 published projection。它必须经过 operator
review，后续再通过 explicit apply/reject command 进入 draft 或终止。

### 4. Dining Truth 不等于 Navigation Spatial Truth

Dining floor/window truth 描述食堂内部楼层图、窗口区域、档口和菜单价格。
Navigation spatial truth 描述校园建筑、道路、入口、路线与可达性。两者可以通过
place/facility ref 关联，但不能互相替代。

`dining.windows.geometry_json` 是 indoor floorplan editor geometry，不是 route
graph truth。

## 结果

- `apps/campus-ops-web` 成为饭堂地图运营工作台。
- `docs/contracts/app-api-campus-ops-http.md` 冻结 ops cross-cutting contract。
- `docs/contracts/app-api-dining-ops-http.md` 冻结 dining ops HTTP contract。
- `docs/data/dining-operations-schema.md` 冻结 dining operations logical schema。
- `docs/architecture/system/campus-ops-web-architecture.md` 冻结 web surface boundary。
- `docs/architecture/domains/dining/architecture.md` 冻结 dining domain boundary。

## 非目标

本 ADR 不决定：

- 商户自助后台
- 实时排队、营业状态、支付或订单系统
- 采集自动覆盖线上数据
- map/feedback 完整运营模块
- MediaWiki、browser account shell 或 OAuth federation 行为
