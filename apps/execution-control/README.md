# execution-control

Go 实现的内部执行运行时。它负责执行准入、Temporal 工作流、个人记忆命令、
终态校验和有界运行投影，不面向浏览器。

## 运行边界

- `app-api` 负责浏览器认证、会话、请求提交和产品传输；
- `agent-runtime` 在单个 Agent Activity 内运行 OpenAI Agents SDK 代理与工具循环；
- `model-config` 独立拥有模型目标、凭据和验证；`execution-control` 只读取 `primary_agent` target 并
  冻结服务返回的 hash，同时轮询 workflow、core activity 和 agent activity 三类 Temporal 队列；
- Temporal 保存 workflow history、重试、超时、heartbeat 和 cancellation；
- PostgreSQL 保存产品、运维和评测需要的有界投影；Campus Docs publisher 单独使用 serving schema
  维护当前索引绑定；
- Hindsight 保存个人记忆，Qdrant 保存当前 Campus Docs 索引的文档 chunk 正文与引用元数据。

## Temporal 工作流

| 工作流 | 用途 | 详细文档 |
| --- | --- | --- |
| `ToolExecutionWorkflow` | 在线回答的 Agent Activity、终态处理和记忆追加 | `docs/architecture/system/durable-runtime.md` |
| `PersonalMemoryCommandWorkflow` | 个人记忆条目、会话和账户级变更 | `docs/architecture/system/memory-plane.md` |

在线回答只使用 workflow、core activity 和 agent activity 三类 task queue。个人记忆函数工具在
Agent Activity 内按需执行，不单独创建 Temporal activity；Campus Docs publisher 不属于在线回答链路。

进程入口只负责配置、服务生命周期和退出协调；Temporal client、poller 与 queue 组装由运行时组装
层拥有。各 queue 的 activity adapter 依赖窄 handler interface，不依赖 HTTP server 的具体类型，
HTTP API 也不拥有 worker 生命周期。

内部实现按以下边界组织：

- `internal/execution` 拥有与传输、Temporal SDK 和数据库无关的执行合同、workflow 身份校验、admission
  规则与持久化端口；
- `internal/executionapplication` 拥有 admission snapshot、run 创建/取消和 Agent 内部工具执行用例；
- `internal/httpapi` 只负责认证、JSON wire 解码、错误映射和响应编码，查询接口可直接读取有界投影；
- `internal/temporalruntime` 拥有 Temporal workflow、activity 名称、SDK 输入输出适配和 worker 注册；
- `internal/temporaladapter` 直接拥有 Temporal activity 方法与业务 handler 的适配，不复制业务规则；
- `internal/executionreconciler` 独立拥有启动、取消和终态收敛状态机，`internal/runtimeassembly`
  统一启动和停止 poller 与 reconciler；reconciler 只依赖 `internal/execution` 合同，不导入 Temporal SDK
  或 HTTP；
- `internal/campusdocs` 拥有索引与检索领域合同，`internal/campusdocspersistence` 实现当前索引的 PostgreSQL
  读取，`internal/outboundadapter` 实现 embedding、Qdrant 和 reranker 调用；
- 冻结的 `internal/providerconfig` 代码只服务历史 Goose migration，不得重新进入常驻 runtime。

## 进程入口

- `execution-control`：生产入口；`8000` 提供内部执行、查询、记忆和健康接口，同时运行三类
  Temporal poller。本地宿主进程通过标准 `HOST` 和 `PORT` 配置监听地址。
- `run-projection-schema`：为本地历史数据库集成测试保留的 Goose runner，不由标准本地 bootstrap 或
  GitOps 调用。新建或重建的本地数据库由 `campus-agent-schema` 直接安装最终结构和授权。

收到 SIGTERM 或运行时致命错误时，`execution-control` 先将 HTTP 准入置为 draining，停止新的业务请求，
并在 `ShutdownGraceMS` 窗口内等待已进入的请求完成。HTTP 阶段结束后才停止 reconciler 和 Temporal
poller，最后关闭运行投影、个人记忆状态和 Temporal starter。超时请求会先收到 context cancellation；
若仍有 handler 不退出，进程不会提前关闭其共享 store，持久化的 start/cancel intent 由下一实例继续收敛。

`internal/schemamigrations/` 与 `public.execution_control_migrations` 为本地历史数据库集成测试保留。
当前共享数据库 migration 位于 `jobs/campus-agent-schema/`，统一记录在
`drizzle.campus_agent_migrations`。运行时 Store 只连接和读写，不自动建表。

具体 HTTP 路径、字段和枚举不在 README 复制：

- 执行接口：`docs/contracts/tool-execution.md`；
- 个人记忆：`docs/architecture/system/memory-plane.md` 与 `docs/contracts/app-api/memory.md`；
- Model Config：`apps/model-config/README.md`、`docs/contracts/ops-web/providers.md` 与
  `docs/environment/providers.md`。

## 本地开发

Go 语言版本与完整工具链版本由 `go.mod` 拥有。`flake.nix` 从中派生本地工具链，Dockerfile 保留
构建镜像所需的版本投影，并由仓库测试检查一致性。优先使用仓库 flake 的 `ci-full` 运行以下命令。

```bash
pnpm --dir apps/execution-control native:format
pnpm --dir apps/execution-control native:lint
pnpm --dir apps/execution-control native:typecheck
pnpm --dir apps/execution-control native:test
pnpm check
```

运行配置和环境操作见 `docs/runbooks/execution.md`、`docs/runbooks/temporal.md` 与
`docs/runbooks/local-verification.md`。README 不保存环境地址、Secret、完整变量清单或部署状态。
