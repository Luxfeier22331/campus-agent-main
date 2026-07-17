---
doc_type: decision
owner_boundary: docs/decisions
decision_id: ADR-0072
status: accepted
partially_supersedes: ADR-0055
partially_superseded_by: ADR-0080
---

# ADR-0072：自托管 Ops Web

## 背景

完整运行诊断需要读取自托管 PostgreSQL 摘要、Temporal 状态和本地日志/trace。旧 Operator
Console 与 app-api provider/operator 路径已由 ADR-0080 退役。

如果让 app-api 代理这些读取，会扩大 browser-facing Worker API 并把内部 credential 放到错误
边界；如果浏览器直连数据源，则会暴露 credential 和任意查询能力。

## 决策

新增 `apps/ops-web` 作为独立、自托管、默认只读的运行诊断应用：

- 一个 Node/Hono 进程同时提供 React 静态应用和固定 `/api/ops/*`；
- 服务端只读取白名单 PostgreSQL 字段，数据库账号只写原始观测读取审计；
- 明确准入的非诊断操作由后续领域 ADR 扩展，当前包括固定门户认证、Dining 和 Provider Config；
- Ops Web 不得创建、列举或删除 Secret，不得选择其他 Schedule、立即触发工作流或返回凭据；
- OpenObserve 查询固定 stream、关联标识和有界时间窗口，浏览器不能提交 SQL 或选择 stream；
- Cloudflare Access 与应用 allowlist 保护全部接口，原始日志/trace 使用更窄权限；
- Temporal UI、Langfuse UI 保留各自完整能力；
- Ops Web 通过同源 BFF 调用 execution-control Provider Config admin；浏览器不继承 admin
  credential，配置后端不可用不阻断请求诊断 readiness。

ADR-0067 对 app-api 与外部观测数据的限制保持不变。本文只增加独立诊断边界和明确列出的
集群内操作，不把 Ops Web 变成通用控制面或产品后端。

源码仓拥有应用、image 和 namespace-neutral base；环境仓拥有访问坐标、配置、secret、network
policy、ingress 和不可变部署选择。

## 后果

- 运维人员增加一个请求中心化诊断入口，以换取内部数据不经过公开 Worker API；
- Ops Web 有独立可用性和凭据生命周期；固定门户凭据与 Schedule 操作不构成通用控制面；
- request 状态仍以 PostgreSQL 产品/执行投影为准，日志平台不能改写；
- 原始观测读取必须审计，审计写入失败时关闭读取；
- manifest 或 image 存在不证明应用已经部署。

## 否决方案

- **扩展 app-api**：扩大公开 API、credential 和攻击面；
- **拆独立 ops-api**：Ops Web 是唯一消费方，一个 Hono 部署单元已经足够；
- **只使用平台原生 UI**：无法提供跨系统请求关联，且外部平台可能不在内网可达；
- **浏览器直连 PostgreSQL/OpenObserve**：无法保护 credential、限制查询或可靠审计。
