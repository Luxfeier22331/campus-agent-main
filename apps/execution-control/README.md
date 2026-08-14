# execution-control

Go 实现的内部执行运行时。它负责执行准入、Temporal 工作流、在线供应商配置、个人记忆命令、
文档 grounding 准备、终态校验和有界运行投影，不面向浏览器。

## 运行边界

- `app-api` 负责浏览器认证、会话、请求提交和产品传输；
- `agent-runtime` 在单个 Agent Activity 内运行 OpenAI Agents SDK 代理与工具循环；
- `execution-control` 在同一进程中提供执行与模型配置 HTTP 接口，并轮询 workflow、core activity
  和 agent activity 三类 Temporal 队列；
- Temporal 保存 workflow history、重试、超时、heartbeat 和 cancellation；
- PostgreSQL 保存产品、运维和评测需要的有界投影，以及知识 release、激活指针和发布身份；
- Hindsight 保存个人记忆，Qdrant 保存当前 release 的文档 chunk 正文与引用元数据。

## Temporal 工作流

| 工作流 | 用途 | 详细文档 |
| --- | --- | --- |
| `ToolExecutionWorkflow` | 在线回答的 grounding、Agent Activity、终态处理和记忆追加 | `docs/architecture/system/durable-runtime.md` |
| `PersonalMemoryCommandWorkflow` | 个人记忆条目、会话和账户级变更 | `docs/architecture/system/memory-plane.md` |

在线回答只使用 workflow、core activity 和 agent activity 三类 task queue。文档检索由 agent
queue 上的 `PrepareGroundingContextActivity` 在 Agent Activity 前统一完成；各文档范围查询、
rerank 和 Agents SDK 函数工具不再分别展开成 Temporal activity。

## 进程入口

- `execution-control`：生产入口；`8000` 提供内部执行、查询、记忆和健康接口，`8001` 提供
  Provider Config 管理接口，同时运行三类 Temporal poller；
- `run-projection-schema`：通过 Goose 安装和验证运行投影、个人记忆状态与 Provider Config
  schema，再独立应用运行角色授权。

Migration 位于 `internal/schemamigrations/`，统一记录在
`public.execution_control_migrations`。运行时 Store 只连接和读写，不自动建表。普通结构变化新增
SQL migration；需要解密并重加密旧 Provider 配置的数据转换使用同一版本序列中的事务型 Go
migration。修改后运行 `pnpm --dir apps/execution-control test:database-integration`。

具体 HTTP 路径、字段和枚举不在 README 复制：

- 执行接口：`docs/contracts/tool-execution.md`；
- 个人记忆：`docs/architecture/system/memory-plane.md` 与 `docs/contracts/app-api/memory.md`；
- Provider Config：`docs/contracts/ops-web/providers.md` 与 `docs/environment/providers.md`。

## 本地开发

要求 Go `1.26.6` 和 `golangci-lint v2.12.2`；仓库 flake 的 `ci-full` 提供这两个版本。

```bash
pnpm --dir apps/execution-control native:format
pnpm --dir apps/execution-control native:lint
pnpm --dir apps/execution-control native:typecheck
pnpm --dir apps/execution-control native:test
pnpm check
```

运行配置和环境操作见 `docs/runbooks/execution.md`、`docs/runbooks/temporal.md` 与
`docs/runbooks/local-smoke.md`。README 不保存环境地址、Secret、完整变量清单或部署状态。
