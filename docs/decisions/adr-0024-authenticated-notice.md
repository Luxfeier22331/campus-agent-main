---
doc_type: decision
owner_boundary: docs/decisions
decision_id: ADR-0024
status: accepted
partially_superseded_by:
  - ADR-0087
  - ADR-0089
---

# ADR-0024 认证通知来源

## 背景

校内门户与公开网站具有不同的身份、访问和采集语义。把两者视为同一来源会混合公开抓取策略
与依赖会话的内部采集，也会让来源事实和下游领域正文失去清晰边界。

## 决策

- 校内门户使用独立来源通道 `internal_portal`；
- `notice` 与 `file_release` 是两个独立来源类型，不互相转换；
- 门户内容不按登录主体形成请求、产物、条目或发布流作用域；
- `jobs/internal-portal-collection` 只负责门户适配、来源对象和明确请求的文件发布，不负责通知规范化、
  文档分块、向量索引或在线发布；
- `jobs/internal-portal-collection` 不持久化 TGC；凭据持久化、检查与解析的当前所有权由 ADR-0089
  管理，本地命令只消费调用方显式提供或显式拉取的认证输入；
- 认证客户端负责会话建立、校验和错误分类，凭据解析由 ADR-0089 管理，具体认证操作与同步步骤由
  数据文档和 runbook 维护；
- 通知来源身份、同步边界、资源关系和下游交接由 ADR-0087 及其数据合同维护。

## 结果

- 认证成功或采集完成不代表通知已经具备在线查询能力；
- 来源对象和规范化通知分别由各自的数据所有者维护；
- 下游规章、校历等领域必须经过自己的校验和发布入口消费通知来源；
- 不把通知采集、认证检查或来源文件发布隐式接入在线检索链路。

## 相关文档

- `../architecture/domains/notices.md`
- `adr-0089-internal-portal-credential-resolution.md`
- `../architecture/system/data-plane.md`
- `../data/internal-portal.md`
- `../data/notices.md`
