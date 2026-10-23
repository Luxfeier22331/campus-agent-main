# Agent Note: 规范化通知存储

Status: implemented

## 背景

来源对象适合保留门户原始结构，但不适合后续通知网站、结构化查询或 RAG 直接消费。在设计
在线消费路径前，需要先建立经模型生成并完成完整性校验的分类、清洗正文和资源 metadata。当时的 `ingestion-control`
只拥有执行控制，不拥有通知内容；采集控制面已由
[简化采集控制面与内部门户凭据所有权](../simplification/2026-08-19-internal-portal-credential-resolution.md)退役。

## 决策

- `internal-portal-collection` 继续拥有原始 JSON、门户 HTML 和原始图片、附件字节；
- 独立 `notice-publisher` 在分类和资源完整性校验后清洗正文并显式物化；人工抽查不属于执行前置条件；
- `packages/domains/notices` 统一拥有领域枚举、资源类型与清洗规则；
- `notices.*` PostgreSQL schema 保存规范化字段与资源 metadata，derived bucket 保存内容寻址资源；
- App API 通过现有 Hyperdrive 以只读角色查询规范化通知，并通过现有私有对象存储路径读取通知图片；
- Campus Web 提供登录后的目录与站内详情，不建立集群内独立通知服务；
- 当时不实施 Agent 结构化查询或 RAG；当前已发布 Notice 的 RAG 消费由
  [单一 Agent 与机构知识边界](./2026-07-29-agent-knowledge-tools.md)及其检索合同维护，该历史范围不再排除现有查询；
- 不增加调度发布、双写、外部网页抓取、批次状态、分类审计或阅读字段；当时不增加对外发布字段
  的决定已由 [通知维护状态收敛](./2026-08-25-notice-maintenance-state.md)的 `is_published` 边界取代。

## 未采用方案

- **让下游直接消费门户原始对象**：省去投影，但原始结构不适合稳定的产品查询与阅读合同。
- **新增独立通知服务或让采集控制面拥有正文**：可以集中入口，却重复现有 App API 读取路径，
  并把执行控制与内容所有权混合。

## 后果

规范化与采集明确分离，源对象不被重写。通知读取复用产品已有的 App API、Hyperdrive 与 Campus Web，
不把采集执行入口、execution-control 或独立服务变成通知内容所有者。资源回填、规范化写入和
环境部署仍需各环境显式执行，不能由 schema、接口或页面源码存在推断为已上线。

### 仍有效与被取代的范围

来源对象、清洗正文、规范化 metadata 和产品读取各自拥有职责的理由继续有效。[通知维护状态收敛](./2026-08-25-notice-maintenance-state.md) 改变了
库存、分类与发布状态的落点：采集阶段先登记数据库，分类直接维护同一通知行，publisher 再显式
发布；旧的分类对象制品不再是线上分类权威。“采集成功不等于发布成功”的边界仍成立。

[单一 Agent 与机构知识边界](./2026-07-29-agent-knowledge-tools.md) 扩展了已发布 Notice 的在线知识消费；这不把源对象直接暴露给 Agent，也不取消规范化与
发布步骤。两个后续 owner 与本篇保持活动，分别维护状态收敛、在线消费和内容所有权的理由。

## 相关文档

- [通知数据](../../../../docs/data/notices.md)
- [通知](../../../../docs/architecture/domains/notices.md)
- [采集运行](../../../../docs/runbooks/ingestion/ingestion.md)
- 部分取代 [内部门户通知来源合同](2026-08-14-internal-portal-notice-source.md)
- 部分被 [单一 Agent 与机构知识边界](./2026-07-29-agent-knowledge-tools.md)和 [通知维护状态收敛](2026-08-25-notice-maintenance-state.md)取代。
