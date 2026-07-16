---
doc_type: architecture
owner_boundary: product-runtime
status: active
---

# 产品运行时

## 文档边界

本文定义 browser-facing 产品、受控配置面、自托管排查面和 execution runtime 的所有权。
HTTP 字段由 contracts 定义，数据库表由 data 文档定义，部署状态由 GitOps 和运行证据定义。

## 组件

| 组件 | 负责 | 不负责 |
| --- | --- | --- |
| `campus-web` | 学生问答、账号、文档、地图、食堂和 campus status 页面 | 运行排查、数据库或内部 runtime 访问 |
| `app-api` | browser auth、chat admission/finalization、产品 API、状态 API、provider 配置 API | Temporal worker、RAG 内部、通用运维数据 API |
| `operator-console-web` | 模型服务配置 | 请求列表、执行诊断、数据库读取 |
| `ops-web` | 自托管请求排查、运行概况、观测入口和固定门户凭据替换 | 产品写操作、模型配置、任意工作流控制或通用 Secret 管理 |
| `execution-control` | durable run admission、Temporal workflow、memory/RAG activities、run projection | browser auth、页面合同、operator config |
| `agent-runtime` | primary agent execution | durable orchestration 和产品数据持久化 |

## Browser 路径

- `campus-web`、`operator-console-web` 和其他 Worker 页面通过 Service Binding 或已配置的
  app-api origin 调用 `app-api`。
- 浏览器不直连 execution-control、Temporal、Hindsight、Qdrant、PostgreSQL 或
  OpenObserve。
- `ops-web` 是独立受保护的自托管站点；其浏览器只调用同一进程的 `/api/ops/*`。

## Chat 路径

```mermaid
flowchart LR
  Browser[campus-web]
  AppAPI[app-api]
  ProductDB[(chat + request observability)]
  Control[execution-control]
  Temporal[Temporal]
  Workers[workflow/activity workers]
  Agent[agent-runtime]
  RunDB[(runtime.agent projections)]

  Browser --> AppAPI
  AppAPI --> ProductDB
  AppAPI --> Control
  Control --> Temporal
  Temporal --> Workers
  Workers --> Agent
  Workers --> RunDB
  AppAPI --> Control
  AppAPI --> ProductDB
```

app-api 在接收 turn 时写 `chat.turn_dispatches` 和 accepted observability fact，随后创建
durable run。execution-control/Temporal 推进执行并写 `runtime.agent_*`。app-api 读取 run
events，最终以原子事务写 assistant message、terminal dispatch 和 observability fact。

完整规则见 `docs/contracts/app-api/request-lifecycle.md`。

## 数据边界

- 会话、消息和轮次派发：`apps/app-api`；
- 工作流 run、event、step、tool 和 memory 投影：`apps/execution-control`；
- 完整 Temporal history：Temporal；
- 模型调用链与评测：Langfuse；
- 日志、指标和调用链：OpenTelemetry、OpenObserve 及已启用平台；
- 个人记忆：Hindsight，仅由 execution-control Activity 调用。

这些数据通过 `request_id`、`run_id`、`trace_id` 和 `conversation_id` 关联，不复制成
operator request projection。

## 校园服务

`campus_services.*` 是班车状态页面和模型可见工具共享的读取模型。
publisher 写一次，app-api status API 与 execution-control tool 分别读取；状态页不调用 tool，
tool 也不通过 app-api。

当前 model-visible campus service 只有 `transport_schedule_lookup`。contract/schema 存在不
代表其他 campus tool 已开放。

## 配置与排查

- `operator-console-web -> app-api` 管理 provider config。
- `ops-web -> PostgreSQL/execution-control/OpenObserve` 提供只读排查；人员可以通过固定接口
  patch `source-collector-internal-portal-auth` 并恢复固定认证维护 Schedule。
- 两个应用不互相代理，也不共享“通用运维后端”。
- Temporal UI、Langfuse UI 和 OpenObserve 保留各自完整能力；Ops Web 只提供跨系统关联和
  常用摘要。

## 部署

- browser-facing Worker 应用由源码 workflow 上传不可变版本，环境仓 Terraform 管理
  custom domain、cron 与流量版本。
- execution-control、workers、ops-web、PostgreSQL 和依赖平台由 Kubernetes/GitOps 管理。
- app-api Worker 通过 Hyperdrive/Workers VPC 访问私有 CNPG，不公开 PostgreSQL。
- source repo 的 base 和镜像不是部署完成证明；环境 repo revision 和运行验证才是部署事实。

## 禁止形态

- 不恢复 supervisor、bootstrap mega-agent 或 flat retrieval tool。
- 不恢复 `runtime.request_execution`、projection outbox 或 operator request projector。
- 不让 operator console 承担 Ops Web 请求诊断。
- 不让 app-api 代理 Temporal、Langfuse、OpenObserve 或数据库通用查询。
- 不把 ingestion/data-plane ownership 混入在线回答路径。
- 不为单一页面消费面拆出无独立 owner 的后端服务。

## 相关文档

- `docs/contracts/app-api/README.md`
- `docs/contracts/app-api/request-lifecycle.md`
- `docs/architecture/system/ops-observability.md`
- `docs/architecture/system/operator-console.md`
- `docs/data/postgres-ownership.md`
- `docs/domains/transport.md`
