---
doc_type: plan
status: deferred
created: 2026-03-29
updated: 2026-04-20
---

# Protected Panel Requests Triage Table Redesign

## 文档边界

本文固定 `apps/protected-panel-web` 中 `Requests` 列表页的后续重构方向。

它负责：

- 把列表页从字段平铺表收口为 triage table
- 固定默认高信号列、toolbar、筛选与列显隐 contract
- 固定列表页与详情页的职责切分

它不负责：

- 改写 `docs/decisions/adr-0016-app-api-request-projection-and-panel-query-ownership.md` 的 ownership
- 让 panel 退化成 raw log、trace 或 sink viewer
- 取代 `Requests` detail 页的深度诊断职责

## Lifecycle Contract

- 文档 lifecycle 保持 `deferred`
- 本文只保留固定 redesign contract，不承担 active execution state
- 如需恢复实施，执行进度只写在 `.planning/WORKSTREAMS.md` 与对应 workstream `STATE.md`

## Current Baseline

当前 merged truth 已固定的前提：

- `Requests` 列表页已消费 app-owned request projection
- request projection / observability ownership 继续归属 `apps/app-api`
- detail 页继续承担 trace、audit、diagnostics 与解释性信息
- 列表页后续重构只能重组信息密度与入口，不得绕开 app-owned truth

## Fixed Redesign Contract

- 列表页默认服务于 triage，而不是字段均匀平铺
- 默认高信号列固定为：
  - 开始时间
  - 状态
  - 问题摘要
  - 主体
  - 目标 / 范围摘要
  - 结果 / 异常摘要
  - 耗时
  - 查看
- 默认隐藏但允许恢复的次级列固定为：
  - request id
  - trace id
  - session id
  - ingress surface
  - capability
- toolbar 至少保留：
  - 搜索
  - 状态筛选
  - 列设置
  - 导出
- 常驻 `aside` 不再占用默认主视图宽度
- detail 页继续承担 observability / audit / diagnostics 深度解释

## Forward Phases

### Phase A: Layout And Toolbar

目标：

- 收口列表骨架、toolbar 与筛选入口

退出条件：

- triage toolbar 成立
- 搜索与状态筛选可直接使用
- 主表获得完整横向空间

### Phase B: High-Signal Cells

目标：

- 固定主体、问题摘要、结果 / 异常摘要的高密度呈现

退出条件：

- 状态 / 异常成为第一视觉信号
- 问题摘要与主体不再退化成窄列噪音

### Phase C: Column Visibility And Filter Depth

目标：

- 提供列显隐与后续扩展 saved-query 的结构前提

退出条件：

- 默认列组合在常见桌面宽度下可读
- 次级列可按需恢复，但不反向污染默认视图

### Phase D: Acceptance Evidence

目标：

- 用 staging / local smoke 证明 requests 页已经从 projection table 收口为 triage table

退出条件：

- 桌面宽度下不再表现为信息平铺表
- 列表页可直接完成状态筛选与异常初筛
- detail 页职责未倒灌到列表页

## Exclusions

固定不包含：

- app-owned operator aggregate API 改写
- `Overview / Quality / Safety/Authz / Cost / Audit` 域扩面
- sink side 查询或 panel-side 拼接 observability truth

## Handoff Rule

后续接手时：

1. 先看 `.planning/WORKSTREAMS.md`
2. 再看对应 workstream `STATE.md`
3. 再回到本文确认固定列表 contract 与排除项

不要再把 `Requests` 列表 redesign 写回实时 execution note。
