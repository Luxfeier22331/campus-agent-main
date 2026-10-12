# memory-service

个人记忆子系统，独立部署 API 与 Temporal Worker，使用自己的 PostgreSQL database/role。
Hindsight 继续拥有记忆内容；本服务拥有命令、追加、generation fence、租约与恢复进度。

## 运行边界

`memory-api` 原子保存请求与派发意图，返回接收结果；`memory-worker` 派发并运行
`MemoryOperationWorkflow`。Workflow 只携带请求 ID，Activity 从 Memory 数据库读取输入，
不读取回答 run、step 或产品消息。追加使用稳定 request ID；终态释放租约后清除输入。
命令结果通过 App API callback 写回产品状态，回调完成前保留恢复所需结果。

App API 管理命令、资料读取和账户清理经 cluster-private-ingress 调用本 API；Agent Runtime 的 recall Activity
调用本 API；control 在产品终态确认后，通过持久投递表交付最小追加输入。
接口入口与字段由 [HTTP adapter](internal/memoryhttp/server.go) 和
[领域合同](memoryruntime/contracts.go) 定义，使用 `x-memory-origin-auth`。

## 配置与启动

API 和 Worker 共用 `MEMORY_DATABASE_URL`、`MEMORY_INTERNAL_SHARED_SECRET`、
`HINDSIGHT_API_BASE_URL`、`HINDSIGHT_API_TENANT_API_KEY`、`HINDSIGHT_OWNER_SALT`。
Worker 另需 `MEMORY_TEMPORAL_ADDRESS`、`MEMORY_TEMPORAL_NAMESPACE`、
`APP_PRODUCT_CALLBACK_BASE_URL` 和 `APP_PRODUCT_CALLBACK_SHARED_SECRET`。
HTTP 监听由 `MEMORY_HOST`、`MEMORY_PORT` 控制，两进程均提供 `/healthz` 与 `/readyz`。

`pnpm dev:init` 为 core 创建独立 Memory 数据库、应用 schema 并生成环境文件；`pnpm dev`
启动两个进程，本地 Worker 使用 `MEMORY_WORKER_PORT`。Hindsight 仍按已有 memory domain
初始化流程单独准备。`pnpm --filter memory-service native:test` 运行单元测试。
独立数据库、迁移与 control 投递事务由 execution-control 的 PostgreSQL 集成套件联合验证。

长期进程不执行 DDL；`campus-agent-schema migrate --target memory` 是 schema 入口。
部署 Secret 由环境仓已有 backend 注入：`memory-service-secrets` 提供数据库 URL 与内部密钥，
`campus-agent-postgres-memory-owner` 提供匹配的 database role 凭据。数据库 URL 必须包含环境的
TLS CA 配置；源码不部署占位凭据。owner salt 必须沿用迁移前值。

迁移步骤见 [执行服务运维](../../docs/runbooks/runtime/execution.md)，选择理由见
[Agent 编排与 Memory 独立服务](../../.agents/notes/implemented/architecture/2026-10-10-agent-orchestration-memory-services.md)。

## Hindsight 配置升级

`memory-config-upgrade` 由 Memory Application 的 PostSync Job 执行，使用同镜像中的当前规则，
通过 Hindsight API 更新本应用已有 bank 的提取配置和 `user-profile` 指令。新建对象使用同一组默认值；
正常读写不做配置比较。该命令不访问 Memory 数据库，不执行 schema 或 `memory-cutover`。
新 Pod 网络策略生效前若连接被拒绝，首次只读 bank 查询最多等待 30 秒；后续写入不自动重试。

当前 Hindsight 0.9.1 的 bank 列表没有分页，画像 API 也不暴露 `last_refreshed_source_query`。
升级先保留其他 trigger 字段并关闭目标画像的整合后自动刷新，等待在途刷新结束，再显式刷新；
成功后恢复自动刷新。失败时 Job 保留，重新 sync 可重跑；自动刷新仍关闭的对象会继续升级，
已完成且配置一致的对象不会再次刷新。升级期间普通记忆读写继续工作。

命令只处理名称为 `campus-agent personal memory` 且 ID 符合本应用规则的 bank；
不创建缺失 bank 或画像，不删除记忆，不修改其他应用的配置。
