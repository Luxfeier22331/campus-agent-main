---
doc_type: decision
owner_boundary: docs/decisions
decision_id: ADR-0088
status: accepted
partially_supersedes: ADR-0087
---
# ADR-0088 规范化通知存储

## 背景

来源对象适合保留门户原始结构，但不适合后续通知网站、结构化查询或 RAG 直接消费。在设计
在线消费路径前，需要先建立经模型生成并完成完整性校验的分类、清洗正文和资源 metadata。`ingestion-control` 只拥有
执行控制，不拥有通知内容。

## 决策

- `source-collector` 继续拥有原始 JSON、门户 HTML 和原始图片、附件字节；
- 独立 `notice-publisher` 在分类和资源完整性校验后清洗正文并显式物化；人工抽查不属于执行前置条件；
- `packages/domains/notices` 统一拥有领域枚举、资源类型与清洗规则；
- `notices.*` PostgreSQL schema 保存规范化字段与资源 metadata，derived bucket 保存内容寻址资源；
- App API 通过现有 Hyperdrive 以只读角色查询规范化通知，并通过现有私有对象存储路径读取通知图片；
- Campus Web 提供登录后的目录与站内详情，不建立集群内独立通知服务；
- 当前不实现 Agent 结构化查询或 RAG；
- 不增加调度发布、双写、外部网页抓取、批次状态、分类审计、阅读或对外发布字段。

## 结果

规范化与采集明确分离，源对象不被重写。通知读取复用产品已有的 App API、Hyperdrive 与 Campus Web，
不把 ingestion-control、execution-control 或独立服务变成通知内容所有者。资源回填、规范化写入和
环境部署仍需各环境显式执行，不能由 schema、接口或页面源码存在推断为已上线。

## 相关文档

- `../data/notices.md`
- `../architecture/domains/notices.md`
- `../runbooks/ingestion.md`
