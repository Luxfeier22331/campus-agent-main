---
doc_type: decision
owner_boundary: docs/decisions
decision_id: ADR-0072
status: accepted
partially_supersedes: ADR-0055
---

# ADR-0072：自托管 Ops Web

## 背景

运行排查需要关联内部状态、工作流和外部观测平台。让公开 App API 代理这些能力会扩大产品接口
和凭据范围；让浏览器直连数据源则会暴露凭据和任意查询能力。少量内部管理操作也需要与学生
产品保持独立授权。

## 决策

使用独立、自托管的 `apps/ops-web` 承担运行排查和明确准入的内部管理操作。

- 浏览器只访问 Ops Web 同源服务端，不持有数据库、工作流、配置或外部平台凭据；
- 服务端只提供固定、最小权限的读取和领域操作，不提供任意查询或通用代理；
- App API 继续只承担学生产品接口，不代理 Ops Web 能力；
- Cloudflare Access policy 负责人员范围，应用验证 JWT 并拒绝服务身份，不复制第二套名单；
- 外部观测与工作流平台保留完整能力，Ops Web 只提供跨系统关联和常用摘要；
- 观测数据不得改写产品状态或工作流状态。

具体页面、接口、数据源和获准操作由产品文档、架构文档和 HTTP 合同维护。ADR-0081 定义外部
观测平台的数据分工；ADR-0074 定义源码仓库和环境仓库边界。

## 后果

- 内部数据不经过公开 App API，Ops Web 具有独立的可用性和权限生命周期；
- 增加管理能力时必须明确数据所有者和固定操作范围；
- 产品和工作流状态仍由各自持久存储维护，观测平台只提供诊断证据。

## 否决方案

- **扩展 app-api**：扩大公开 API、凭据和攻击面；
- **拆出独立 Ops API**：只有 Ops Web 消费这些接口，额外服务不会形成新的所有权边界；
- **只使用平台原生 UI**：无法提供跨系统请求关联，且外部平台可能不在内网可达；
- **浏览器直连内部或外部数据源**：无法保护凭据或限制查询。

## 相关文档

- `../product/ops-web.md`
- `../architecture/system/ops-observability.md`
- `../contracts/ops-web/README.md`
- `adr-0081-observability-planes.md`
