---
doc_type: decision
owner_boundary: docs/decisions
decision_id: ADR-0055
status: superseded
superseded_by:
  - ADR-0072
  - ADR-0079
  - ADR-0080
---
# ADR-0055 统一运维界面

## 背景

本决策曾把运行诊断、领域运营和模型配置统一到 Operator Console，并要求所有操作通过 app-api。
后续实现证明这些工作具有不同的部署、权限和数据访问边界。

## 历史决策

Operator Console 曾被定义为唯一运维产品，负责请求排查、领域操作和供应商配置，不允许其他服务
直接访问数据库或观测系统。

## 取代

- ADR-0072 将运行诊断收敛到自托管 Ops Web。
- ADR-0079 将食堂草稿、发布、回滚和评价治理收敛到 Ops Web 的专用 Dining 数据库角色。
- ADR-0080 进一步删除 Operator Console，把模型服务配置迁入 Ops Web，并从 app-api 删除该接口。

三个界面和后端边界不得重新合并成通用管理代理。当前事实见
`docs/decisions/adr-0080-ops-web.md`、`docs/product/ops-web.md` 和
`docs/architecture/domains/dining/architecture.md`。
