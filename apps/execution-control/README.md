# execution-control

Go 实现的内部执行运行时。它负责执行准入、Temporal 工作流、在线供应商配置、个人记忆命令、
知识查询、终态校验、有界运行投影和运行时可观测性，不面向浏览器。

## 运行边界

- `app-api` 负责浏览器认证、会话、请求提交和产品传输；
- `agent-runtime` 在单个 Agent Activity 内运行 OpenAI Agents SDK 代理与工具循环；
- `execution-control` 调度持久工作、执行内部工具与知识查询，并校验终态；
- Temporal 保存 workflow history、重试、超时、heartbeat 和 cancellation；
- PostgreSQL 只保存产品、运维和评测需要的有界投影；
- Hindsight 保存个人记忆，Qdrant 保存机构知识索引。

## Temporal 工作流

| 工作流 | 用途 | 详细文档 |
| --- | --- | --- |
| `ToolExecutionWorkflow` | 在线回答的记忆召回、Agent Activity、终态处理和记忆追加 | `docs/architecture/system/durable-runtime.md` |
| `PersonalMemoryCommandWorkflow` | 个人记忆条目、会话和账户级变更 | `docs/architecture/system/memory-plane.md` |
| `LangfuseTraceRetentionWorkflow` | Langfuse trace 保留期维护 | `docs/contracts/langfuse-runtime.md` |

在线回答只使用 workflow、core activity 和 agent activity 三类 task queue。Agents SDK 内部的
handoff、函数工具与知识搜索不展开成额外 Temporal activity。

## 进程入口

- `execution-control`：内部执行、查询、记忆和健康接口；
- `workflow-worker`：确定性工作流；
- `activity-worker-core`：记忆、终态处理和维护 activity；
- `activity-worker-agent`：完整 Agent Activity；
- `provider-config-admin`：在线 Provider Config 管理接口；
- `personal-memory-runtime`：个人记忆命令入口；
- `run-projection-schema`：安装和验证运行投影与 Provider Config schema。

具体 HTTP 路径、字段和枚举不在 README 复制：

- 执行接口：`docs/contracts/tool-execution.md`；
- 工具读取：`docs/contracts/tool-read-model.md`；
- 队列诊断：`docs/contracts/temporal-queues.md`；
- 个人记忆：`docs/architecture/system/memory-plane.md` 与 `docs/contracts/app-api/memory.md`；
- Provider Config：`docs/contracts/ops-web/providers.md` 与 `docs/environment/providers.md`。

## 本地开发

要求 Go `1.26.x` 和 `golangci-lint v2.11.4`。

```bash
pnpm go:check
pnpm repo:static
```

运行配置和环境操作见 `docs/runbooks/execution.md`、`docs/runbooks/temporal.md` 与
`docs/runbooks/local-smoke.md`。README 不保存环境地址、Secret、完整变量清单或部署状态。
