# execution-control

Go 实现的内部执行运行时。它负责执行准入、Temporal 工作流、个人记忆命令、
终态校验和有界运行投影，不面向浏览器。

## 运行边界

- `app-api` 负责浏览器认证、会话、请求提交和产品传输；
- `agent-runtime` 在单个 Agent Activity 内运行 OpenAI Agents SDK 代理与工具循环；
- `model-config` 独立拥有模型目标、凭据和验证；`execution-control` 只读取 `primary_agent` target 并
  冻结服务返回的 hash，同时轮询 workflow、core activity 和 agent activity 三类 Temporal 队列；
- Temporal 保存 workflow history、重试、超时、heartbeat 和 cancellation；
- PostgreSQL 保存产品、运维和评测需要的有界投影；统一 Campus RAG publisher 使用 serving schema
  维护当前索引绑定；
- Hindsight 保存个人记忆，Qdrant 保存当前 Campus RAG 索引的 Docs/Notice chunk 正文与引用元数据。

## Temporal 工作流

| 工作流 | 用途 | 详细文档 |
| --- | --- | --- |
| `ToolExecutionWorkflow` | 在线回答的 Agent Activity、终态处理和记忆追加 | `docs/architecture/system/durable-runtime.md` |
| `PersonalMemoryCommandWorkflow` | 原生记忆增改、停用/恢复和账户级变更 | `docs/architecture/system/memory-plane.md` |

在线回答只使用 workflow、core activity 和 agent activity 三类 task queue。个人记忆函数工具在
Agent Activity 内按需执行，不单独创建 Temporal activity；Campus RAG publisher 不属于在线回答链路。

进程入口只负责配置、服务生命周期和退出协调；Temporal client、poller 与 queue 组装由运行时组装
层拥有。各 queue 的 activity adapter 依赖窄 handler interface，不依赖 HTTP server 的具体类型，
HTTP API 也不拥有 worker 生命周期。

内部实现按以下边界组织：

- `internal/execution` 拥有与传输、Temporal SDK 和数据库无关的执行合同、workflow 身份校验与 admission
  规则；
- `internal/executionapplication` 拥有 run、receipt、memory、workflow control 和 outbound ports，执行
  admission、run 创建/取消、receipt 状态管理和 Agent 内部工具用例；工具合同文件由 `internal/toolcontract`
  读取后通过 application port 注入；
- `internal/httpapi` 只负责认证、JSON wire 解码、错误映射和响应编码，查询接口可直接读取有界投影；
- `internal/temporalruntime` 拥有 Temporal workflow、activity 名称和独立的 workflow/activity DTO；
- `internal/temporaladapter/execution`、`memory`、`finalization` 分别实现执行、记忆和终态 activity，
  `finalization/projection` 通过 application RunStore 写投影；`contract` 与 `control` 负责合同转换和控制适配；
- `internal/executionpersistence` 分别实现 run 与 receipt 存储，receipt 的保留期限随父 run，删除由同一锁或
  数据库外键事务完成；activity 通过 application receipt service 保存完整输出和 hash；
- `internal/executionreconciler` 独立拥有启动、取消和终态收敛状态机，`internal/runtimeassembly`
  唯一负责生产依赖组装、Temporal client、worker 注册及生命周期；reconciler 依赖 application ports，
  不导入 Temporal SDK 或 HTTP；
- `internal/campusdocs` 拥有索引与检索领域合同，`internal/campusdocspersistence` 实现当前索引的 PostgreSQL
  读取，`internal/outboundadapter` 实现 embedding、Qdrant 和 reranker 调用；
- `internal/embedding` 拥有独立的 Embedder 端口与进程内精确向量缓存，不依赖 Temporal、执行合同、
  Model Config 或 Qdrant；检索适配器解析当前 provider 配置并注入 HTTP 实现，继续通过已有
  `campusdocs.Searcher` 为工具服务。未来拆分检索运行时可迁移这一边界，不新增检索服务端口。

## 进程入口

- `execution-control`：生产入口；`8000` 提供内部执行、查询、记忆和健康接口，同时运行三类
  Temporal poller。本地宿主进程通过标准 `HOST` 和 `PORT` 配置监听地址。

收到 SIGTERM 或运行时致命错误时，`execution-control` 先将 HTTP 准入置为 draining，停止新的业务请求，
并在 `ShutdownGraceMS` 窗口内等待已进入的请求完成。HTTP 阶段结束后才停止 reconciler 和 Temporal
poller，最后关闭运行投影、个人记忆状态和 Temporal starter。超时请求会先收到 context cancellation；
若仍有 handler 不退出，进程不会提前关闭其共享 store，持久化的 start/cancel intent 由下一实例继续收敛。

当前共享数据库 schema 由 `jobs/campus-agent-schema/` 安装，统一记录在
`drizzle.campus_agent_migrations`。运行时 Store 只连接和读写，不自动建表；PostgreSQL 集成测试也通过
该共享 Job 准备数据库，不再编译或调用应用自有 schema runner。

具体 HTTP 路径、字段和枚举不在 README 复制：

- 执行接口：`docs/contracts/tool-execution.md`；
- 个人记忆：`docs/architecture/system/memory-plane.md` 与 `docs/contracts/app-api/memory.md`；
- Model Config：`apps/model-config/README.md`、`docs/contracts/ops-web/providers.md` 与
  `docs/environment/providers.md`。

## 本地开发

Go workspace 和工具链版本由根 `go.work` 拥有，模块的语言版本保留在 `go.mod`。
`flake.nix` 使用锁定 Nix 工具并核对版本，Dockerfile 保留构建所需的版本投影。
以下包级命令在仓库 `ci-go` 环境执行；全量源码检查使用 `pnpm check`。

```bash
pnpm --dir apps/execution-control native:format
pnpm --dir apps/execution-control native:lint
pnpm --dir apps/execution-control native:vet
pnpm --dir apps/execution-control native:test
pnpm check
```

测试按依赖分层运行：

| 入口 | 范围与依赖 |
| --- | --- |
| `native:test` | workflow/adapter/HTTP 单元与组件测试，不启动外部服务 |
| `test:temporal-integration` | 真实 Temporal workflow、HTTP starter、取消、超时、finalization 和即时 replay |
| `test:temporal-replay` | 已提交 history 的独立 replay，不启动 Temporal Server 或 activity |
| `test:stream-integration` | 本地 `httptest.Server` SSE、真实 consumer 和 in-memory projection，不启动 Temporal |
| `test:database-integration` | testcontainers PostgreSQL、共享 schema、receipt 和投影持久化，不启动 Temporal |

Temporal integration 的 operation 合同测试启动真实 Node Runtime HTTP 服务，使用受控模型 runner；
需要本地 Node 和 agent-runtime 依赖。其余 integration 不隐式启动产品服务，也不连接 staging。
完整产品链路验证仍由产品测试入口负责。

`integration/temporal` 拥有真实 workflow、history replay 和取消场景，`integration/execution_http`
通过公开构造接口组装 HTTP、application service、reconciler 和 Temporal starter。活动 fake 由
`integration/temporalfake` 及 HTTP 测试包拥有；`integration/temporaltest` 只管理每个测试包的
Dev Server、worker 和 workflow 清理。`internal/` 下的测试不启动 Temporal Server。

```bash
pnpm --dir apps/execution-control test:temporal-integration
pnpm --dir apps/execution-control test:temporal-replay
pnpm --dir apps/execution-control test:stream-integration
pnpm --dir apps/execution-control test:database-integration
```

Temporal fixture 按包管理 Dev Server，按测试管理 worker 和唯一 workflow ID。测试失败时走 cleanup；
包超时前预留 worker、client 和 server 的关闭时间。子进程测试会验证失败和超时后的监听端口已关闭。
受保护 history 的用途和更新命令见 [replay fixtures](./integration/temporal/testdata/replay/README.md)。

PR 对受影响的 Go 包（包括 execution-control 与 model-config）运行 `native:format`、`native:lint`、`native:vet`、`native:test`。
Temporal、stream、replay 和 PostgreSQL 在 GitHub 手动 validation profile 中分别选择，暂不作为 PR
required service checks。本地 Dev Server fixture 不用于部署验证。

运行配置和环境操作见 `docs/runbooks/runtime/execution.md`、`docs/runbooks/runtime/temporal.md` 与
`docs/runbooks/local-verification.md`。README 不保存环境地址、Secret、完整变量清单或部署状态。
