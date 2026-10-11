# cluster-private-ingress

Cloudflare App API 到集群产品接口的私有 HTTP 入口。它负责入口认证、固定路由和后端凭据注入，
不拥有 Agent 编排、Memory 状态、数据库、用户认证或对象存储协议。

## 通信合同

`app-api → CLUSTER_PRIVATE_API → cluster-private-ingress → execution-control / memory-service`。

- Worker 使用 `x-edge-ingress-auth`；入口验证 `EDGE_INGRESS_SHARED_SECRET`。
- `/v1/control` 前缀被移除后，转发到 `EXECUTION_CONTROL_BASE_URL`，注入
  `EXECUTION_CONTROL_INGRESS_SHARED_SECRET` 对应的 `x-worker-origin-auth`。
- `/v1/memory` 前缀被移除后，转发到 `MEMORY_SERVICE_BASE_URL`，注入
  `MEMORY_INTERNAL_SHARED_SECRET` 对应的 `x-memory-origin-auth`。
- 仅开放运行创建、查询、事件、取消、账户删除，以及 Memory 产品管理接口；实际路由表在
  `internal/ingress/server.go`。Runtime 的 recall、append 和投影接口不通过入口。
- 请求体、query、业务状态码和响应体透传，流式响应及时 flush，取消传递给后端；不添加业务重试。
  连接超时为 5 秒，响应头超时为 125 秒；Worker 保留原有业务超时。
- 只传递 Content-Type、Accept、Traceparent、Tracestate、X-Request-Id，后端认证由入口重新设置。
- `/healthz`、`/readyz` 是无认证进程探针；ready 不探测后端业务就绪。启动要求两个后端 origin 和三个凭据。
- `LISTEN_ADDR` 默认 `:8000`；后端只接受 HTTP(S) origin，不能配置路径、用户信息或 query。

Object Store 继续使用独立 `OBJECT_STORE_PRIVATE` binding，保留 S3 签名与流式协议。
`APP_API_EXECUTION_SHARED_SECRET` 仍用于集群到 App API 的产品回调，不授予 Control 入站权限。

## 开发与发布

`pnpm dev:init -- --target core` 生成 worktree 隔离的入口地址及独立凭据；`pnpm dev` 启动入口。
单独启动使用 `pnpm --dir apps/cluster-private-ingress dev`。
快速检查使用 `pnpm --dir apps/cluster-private-ingress native:test` 和 `native:vet`；跨进程 HTTP
边界使用 `pnpm --dir apps/cluster-private-ingress test:e2e`。

Source 提供镜像和 K8s base；GitOps 配置 Secret、镜像版本、VPC Service 与 connector。
源码交付不代表集群已切换，部署步骤见[执行运维](../../docs/runbooks/runtime/execution.md)。
设计理由见[集群私有入口](../../.agents/notes/implemented/architecture/2026-10-11-cluster-private-ingress.md)。
