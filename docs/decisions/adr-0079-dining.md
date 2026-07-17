---
doc_type: decision
owner_boundary: docs/decisions
decision_id: ADR-0079
status: accepted
supersedes:
  - ADR-0049 的食堂发布生命周期
  - ADR-0055 的食堂运维界面与 app-api 所有权
---

# ADR-0079 食堂运维边界

## 状态

2026-07-16 接受。

本文只替代 ADR-0049、ADR-0055 中关于 Dining operations 实现、数据写入和发布流程的决策；
两份 ADR 的其他历史判断保持不变。

## 背景

旧设计让 Operator Console 通过 app-api 管理候选版本、审批、排期和发布。这个链路把公共应用
中间层变成了领域控制面，也为尚不存在的组织流程引入了 candidate、approval 和 schedule 状态。
当前产品只需要采集、人工校正、校验、发布和回滚。

## 决策

- `apps/ops-web` 是 Dining operations 的 self-hosted 服务和页面，使用专用数据库角色直连
  PostgreSQL，不经过 app-api。
- `apps/app-api` 只读取 `dining.publication`、`dining.releases` 和公开评价，提供学生端
  `/api/dining/*`。
- `jobs/dining-sync` 定时从 Feishu/Lark 写入 source observations；评价审核通过后可自动进入公开
  投影，catalog observations 只能由 Ops 人工 rebase、validate、publish。
- catalog 流程固定为 `draft -> validate -> publish`。rollback 产生新的 immutable release，
  不移动历史指针伪装成新版本。
- floorplan layout、生成 manifest 和 immutable SVG 由仓库与 Campus Web 应用版本拥有，不进入对象
  存储、catalog release 或数据库 source truth。数据库只保存稳定 `floorplanId`、`kind` 和窗口到
  anchor 的绑定；digest URL、canvas、anchor inventory 和 geometry 不进入 app-api transport。
- 本地地图编辑器保存 canonical layout，静态资产生成是独立显式动作；Campus Web 只从自身构建的
  manifest 解析地图资产。rollback 目标必须与当前 manifest 兼容。
- PostgreSQL 角色分为 migration、sync、ops 和 public read；运行时角色不得建表或重建 schema。
- 保留最近 30 个 catalog releases。

## 删除的设计

- app-api `/api/ops/dining/*`
- Operator Console Dining workspace/proxy
- release candidate、approval、schedule 和 latest-pointer/snapshot 双表
- catalog 自动发布
- `review_projections` 复制表

## 结果

Dining 的写入责任、发布责任和公共读取责任不再重叠。Feishu/Lark 的新数据不会自动覆盖人工校正，
学生端只看到显式发布的 catalog 和审核通过的评价。
