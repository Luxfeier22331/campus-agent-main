# Agent Note: 自托管 Ops Web

Status: implemented

## 背景

运行排查需要关联内部状态、工作流和外部观测平台。让公开 App API 代理这些能力会扩大产品接口
和凭据范围；让浏览器直连数据源则会暴露凭据和任意查询能力。少量内部管理操作也需要与学生
产品保持独立授权。

ADR-0055 原先试图合并分散的诊断与业务运营入口，让单一 Worker 界面通过 App API 读取投影、
管理模型配置，并为食堂、采集、质量与成本等领域预留统一产品位置。它避免浏览器直连高权限
数据源，也试图消除多个后台的重复建设；但把统一界面进一步解释为统一 App API 所有权，会让
学生产品接口同时承担配置、运维准入和采集状态。

## 决策

使用独立、自托管的 `apps/ops-web` 承担运行排查和明确准入的内部管理操作。

- 浏览器只访问 Ops Web 同源服务端，不持有数据库、工作流、配置或外部平台凭据；
- 服务端只提供已定义的读取和领域操作，不提供任意查询或通用代理；
- App API 继续只承担学生产品接口，不代理 Ops Web 能力；
- Cloudflare Access policy 负责人员范围，应用验证 JWT 并拒绝服务身份，不复制第二套名单；
- 外部观测与工作流平台保留完整能力，Ops Web 只提供跨系统关联和常用摘要；
- 观测数据不得改写产品状态或工作流状态。

具体页面、接口、数据源和获准操作由产品文档、架构文档和 HTTP 合同维护。[可观测数据边界](./2026-07-17-observability-planes.md) 定义外部
观测平台的数据分工；[源码仓库与环境仓库边界](../process/2026-07-16-repository-boundary.md) 定义源码仓库和环境仓库边界。

### 控制台退役边界

后续 ADR-0080 退役 Operator Console，并把能力移交 runtime owner，保留 Ops Web 作为运维浏览器。
旧 App API 的 provider/operator/WeChat ledger 不迁移、不导出、不双写，也不保留兼容读取。这一
选择放弃了旧后台状态与统一 operator API 的连续性，换取产品接口和运行管理职责分离；不能为了
恢复旧入口重新扩大 App API 权限，或把运维操作开放为学生可调用的 Agent 工具。

## 未采用方案

- **扩展 app-api**：扩大公开 API、凭据和攻击面；
- **拆出独立 Ops API**：只有 Ops Web 消费这些接口，额外服务不会形成新的所有权边界；
- **只使用平台原生 UI**：无法提供跨系统请求关联，且外部平台可能不在内网可达；
- **浏览器直连内部或外部数据源**：无法保护凭据或限制查询。

## 后果

- 内部数据不经过公开 App API，Ops Web 具有独立的可用性和权限生命周期；
- 增加管理能力时必须明确数据所有者和固定操作范围；
- 产品和工作流状态仍由各自持久存储维护，观测平台只提供诊断证据。

### 历史配置与采集所有权

ADR-0080 当时仍让 execution-control 拥有版本化 Provider Config、profile、validation、activation
bundle、receipt 与 audit，并用 keyring 加密凭据；Ops Web 区分读写凭据、human allowlist、origin、
JSON 和幂等约束，配置后端故障不阻断诊断 readiness。它还把 WeChat collector 的
start/heartbeat/finalize、产物引用与可靠 outbox dispatch 交给 ingestion-control。这些是当时的
实施选择，不能作为恢复旧服务或状态模型的当前要求。

模型配置如今由 [Model Config 独立边界](./2026-08-22-model-config-boundary.md) 的 Model Config 边界
承接；采集控制面的退役与现行凭据边界由
[简化采集控制面与内部门户凭据所有权](../simplification/2026-08-19-internal-portal-credential-resolution.md)承接。
历史食堂 draft/candidate/release/audit 分层、来源 observation 只作 proposal、学生发布投影与运营
草稿分离，以及空间数据独立所有权，曾是旧控制台的领域约束，不是恢复食堂运营后台的授权；
重新开放需明确用户操作、领域合同和验收。App API namespace 或旧 Worker 路由名本身不能证明能力仍在。
旧文档没有可沿用的退役验证结果，不把旧页面或测试清单当作当前实现证据。

## 相关文档

- [Ops Web 产品需求](../../../../docs/product/ops-web.md)
- [Ops Web 接口](../../../../docs/contracts/ops-web/README.md)
- [可观测数据边界](./2026-07-17-observability-planes.md)
