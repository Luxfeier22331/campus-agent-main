---
doc_type: decision
owner_boundary: docs/decisions
decision_id: ADR-0049
status: superseded
superseded_by: ADR-0079
---
# ADR-0049 食堂候选发布

## 背景

本决策曾要求食堂内容通过 app-api 管理候选版本、审批、排期、发布快照和最新指针。该模型隔离了
来源观测与学生读取，但把领域写入面放进了公共应用中间层，并引入了当前产品不需要的审批状态。

## 历史决策

历史流程为 `draft -> candidate -> approve -> publish -> latest pointer`，Operator Console 通过
app-api 运维接口管理该流程。

## 取代

ADR-0079 已完整取代本决策。当前食堂运维由 Ops Web 直连专用 PostgreSQL 角色完成，流程收敛为
`draft -> validate -> immutable release -> publication`；app-api 只读取公开投影。

当前事实见：

- `docs/decisions/adr-0079-dining.md`
- `docs/architecture/domains/dining/architecture.md`
- `docs/data/dining.md`
