# execution-control

Go 实现的内部执行运行时。它负责执行准入、Temporal 工作流、在线供应商配置、个人记忆命令、
Campus Docs 检索、终态校验和有界运行投影，不面向浏览器。

## 运行边界

- `app-api` 负责浏览器认证、会话、请求提交和产品传输；
- `agent-runtime` 在单个 Agent Activity 内运行 OpenAI Agents SDK 代理与工具循环；
- `execution-control` 在同一进程中提供执行与模型配置 HTTP 接口，并轮询 workflow、core activity
  和 agent activity 三类 Temporal 队列；
- Temporal 保存 workflow history、重试、超时、heartbeat 和 cancellation；
- PostgreSQL 保存产品、运维和评测需要的有界投影，以及 Campus Docs 当前索引绑定；
- Hindsight 保存个人记忆，Qdrant 保存当前 Campus Docs 索引的文档 chunk 正文与引用元数据。

## Temporal 工作流

| 工作流 | 用途 | 详细文档 |
| --- | --- | --- |
| `ToolExecutionWorkflow` | 在线回答的 Campus Docs 检索、Agent Activity、终态处理和记忆追加 | `docs/architecture/system/durable-runtime.md` |
| `PersonalMemoryCommandWorkflow` | 个人记忆条目、会话和账户级变更 | `docs/architecture/system/memory-plane.md` |

在线回答只使用 workflow、core activity 和 agent activity 三类 task queue。文档检索由 agent
queue 上的 `RetrieveCampusDocsEvidenceActivity` 在 Agent Activity 前执行；向量查询、候选选择和
Agents SDK 函数工具不再分别展开成 Temporal activity。

进程入口只负责配置、服务生命周期和退出协调；Temporal client、poller 与 queue 组装由运行时组装
层拥有。各 queue 的 activity adapter 依赖窄 handler interface，不依赖 HTTP server 的具体类型，
HTTP API 也不拥有 worker 生命周期。

内部实现按以下边界组织：

- `internal/temporalruntime` 拥有 workflow、activity 名称、输入输出合同和 worker 注册；
- `internal/primaryagentactivity`、`internal/memoryactivity` 与 `internal/finalizationactivity` 只把
  Temporal activity 方法映射到对应业务 handler，不复制业务规则；
- `internal/executionreconciler` 独立拥有启动、取消和终态收敛状态机，`internal/runtimeassembly`
  统一启动和停止 poller 与 reconciler；
- `internal/execution` 拥有执行输入读取，`internal/providerconfig` 拥有在线配置解析，
  `internal/retrievalruntime` 拥有 Qdrant 传输与 collection 兼容检查；这些实现不得回流到
  `internal/httpapi`。

## 进程入口

- `execution-control`：生产入口；`8000` 提供内部执行、查询、记忆和健康接口，`8001` 提供
  Provider Config 管理接口，同时运行三类 Temporal poller；
- `run-projection-schema`：通过 Goose 安装和验证运行投影、个人记忆状态与 Provider Config
  schema，再独立应用运行角色授权。

Migration 位于 `internal/schemamigrations/`，统一记录在
`public.execution_control_migrations`。运行时 Store 只连接和读写，不自动建表。普通结构变化新增
SQL migration；需要事务型数据转换时使用同一版本序列中的 Go migration。修改后运行
`pnpm --dir apps/execution-control test:database-integration`。

具体 HTTP 路径、字段和枚举不在 README 复制：

- 执行接口：`docs/contracts/tool-execution.md`；
- 个人记忆：`docs/architecture/system/memory-plane.md` 与 `docs/contracts/app-api/memory.md`；
- Provider Config：`docs/contracts/ops-web/providers.md` 与 `docs/environment/providers.md`。

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
