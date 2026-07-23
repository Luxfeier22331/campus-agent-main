---
doc_type: decision
owner_boundary: docs/decisions
decision_id: ADR-0079
status: accepted
supersedes:
  - ADR-0049
  - ADR-0055
---
# ADR-0079 食堂写入与发布边界

## 背景

食堂目录需要定期接收外部来源，同时允许人工修正、显式发布和回滚。评价需要独立审核和可见性
治理。把这些写操作放进学生产品 API 会混合公共读取、来源同步和内容运营权限。

## 决策

- `jobs/dining-sync` 写入来源观测、评价审核结果和公开附件，不自动发布目录；
- `apps/ops-web` 使用专用数据库角色执行草稿重建、人工修正、校验、发布、回滚和评价治理；
- `apps/app-api` 只读取当前 publication、不可变 release 和公开评价；
- 目录按照“草稿、校验、发布”流转，回滚创建新的不可变 release；
- 来源更新先形成观测，重新生成草稿时继续应用有效的人工修正；
- 地图布局、静态 SVG 和摘要清单随 Campus Web 代码版本发布，数据库只保存稳定地图标识和窗口
  锚点绑定；
- 评价图片使用独立 `campus-dining-media` bucket，私有 quarantine 一天后过期，审核通过的
  content-addressed public 对象匿名只读；
- schema migration、来源同步、内容运营和公共读取使用彼此独立的数据库角色。

## 结果

- 外部来源不会直接覆盖已发布目录或人工修正；
- 学生端只能读取经过显式发布的目录和审核通过的评价；
- 地图资产可以随应用版本演进，不进入目录数据库和公共接口；
- 公共产品 API 不持有 Dining 内容运营权限。

## 未采用方案

- 通过 app-api 提供 Dining 管理接口；
- 为当前不存在的审批组织流程维护候选、审批和排期状态；
- 让来源同步自动发布目录；
- 把地图字节、坐标和静态资源地址复制到数据库 release。

## 相关文档

- `../architecture/domains/dining.md`
- `../data/dining.md`
- `../runbooks/dining.md`
