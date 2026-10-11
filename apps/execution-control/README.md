# execution-control

Go 实现的内部执行运行时。它负责执行准入、Temporal 工作流、个人记忆命令、
终态校验和有界运行投影，不面向浏览器。

TypeScript Agent Workflow 已由 agent-runtime Worker 拥有。control 通过 `internal/runtimeapi`
提供 Runtime 载荷、模型 receipt、事件与终态投影的 typed API，保留唯一投影写入所有权。
独立 Memory 模式通过 `MEMORY_SERVICE_BASE_URL` 调用 Memory API，回答终态事务发布持久追加投递。
`AGENT_RUNTIME_ROLLOUT_PERCENT` 控制新 run 的 owner 分桶比例；旧 Go Workflow 与本地 Memory
装配仅在双轨期间保留。部署切换见 [运维入口](../../docs/runbooks/runtime/execution.md)。

## 运行边界

- `app-api` 负责浏览器认证、会话、请求提交和产品传输；
- `agent-runtime` 执行当前模型 operation；配置选中的 OpenAI Agents SDK 或 Gemini runner 负责该
  operation 内的模型与工具循环；
- `model-config` 独立拥有模型目标、凭据和验证；`execution-control` 只读取 `primary_agent` target 并
  冻结服务返回的 hash；独立 Worker 轮询三类 Temporal 队列；
- Temporal 保存 workflow history、重试、超时、heartbeat 和 cancellation；
- PostgreSQL 保存产品、运维和评测需要的有界投影；统一 Campus RAG publisher 使用 serving schema
  维护当前索引绑定；
- Hindsight 保存个人记忆，Qdrant 保存当前 Campus RAG 索引的 Docs/Notice chunk 正文与引用元数据。

## Temporal 工作流

| 工作流 | 用途 | 详细文档 |
| --- | --- | --- |
| `ToolExecutionWorkflow` | 在线回答的 Solve、按需计划执行与重规划、合成、终态处理和记忆追加 | `docs/architecture/system/durable-runtime.md` |
| `PersonalMemoryCommandWorkflow` | 原生记忆增改、停用/恢复和账户级变更 | `docs/architecture/system/memory-plane.md` |

在线回答只使用 workflow、core activity 和 agent activity 三类 task queue。个人记忆函数工具在
Solve 或 Execute Step Activity 内按需执行，不单独创建 Temporal activity；四类模型 operation 分别注册为
Activity，整轮请求可以执行多个 operation。Campus RAG publisher 不属于在线回答链路。

进程入口只负责配置、服务生命周期和退出协调；Temporal client、poller 与 queue 组装由运行时组装
层拥有。各 queue 的 activity adapter 依赖窄 handler interface，不依赖 HTTP server 的具体类型，
HTTP API 也不拥有 worker 生命周期。

内部实现按以下边界组织：

- `internal/execution` 拥有与传输、Temporal SDK 和数据库无关的执行合同、workflow 身份校验与 admission
  规则；
- `internal/executionapplication` 拥有 run、receipt、workflow control 和执行 outbound ports，执行
  admission、run 创建/取消、receipt 状态管理、账号删除协调和共享运行内工具身份校验；搜索与记忆召回由独立用例及 HTTP port 承接；`operation` 拥有
  模型调用编排与流事件投影，`finalization` 拥有终态校验、回调和恢复，`projection` 拥有步骤投影规则。工具合同文件由
  `internal/toolcontract` 读取后通过 application port 注入；
- `apps/memory-service/memoryapplication` 拥有记忆管理、命令执行与 receipt、访问 fence、异步追加恢复及所需端口，
  不导入回答应用、HTTP、Temporal SDK、provider 或 persistence；
- `internal/httpapi` 只负责认证、JSON wire 解码、错误映射和响应编码，查询接口可直接读取有界投影；
- `internal/temporalruntime` 拥有 Temporal workflow、activity 名称和独立的 workflow/activity DTO；
- `internal/temporaladapter/execution`、`memory`、`finalization` 分别实现执行、记忆和终态 activity，
  记忆 adapter 只做 DTO、Activity 身份和错误映射；`answermemory` 桥接负责回答完成校验、输入读取与
  `memory.append` 投影，向记忆应用提供追加输入和 checkpoint 接口；
  `executioncontext` 校验 Activity 身份并提取调用元数据；`projection` 将这些元数据传给应用 Writer，
  不再实现业务投影规则；
  `activitysupport` 提供无状态 heartbeat 与错误映射，输入读取由 application `InputReader` 单独注入，
  记忆和回答终态各自依赖所需的回调接口；`contract` 与 `control` 负责合同转换和控制适配；
- `internal/executioncontract` 定义独立于 Temporal DTO 的 operation 数据和计划规则；
  `internal/agentruntimeprotocol` 定义 wire 数据，`internal/outboundadapter` 拥有 Runtime 编码、HTTP/JSON/SSE
  解码及错误分类；应用只消费内部类型，receipt 准入前由本地 Prepare 校验请求并生成指纹；
  `internal/executionreadmodel` 仅依赖七方法只读端口；
- `internal/executionpersistence` 分别实现 run 与 receipt 存储，receipt 的保留期限随父 run，删除由同一锁或
  数据库外键事务完成；activity 通过 application receipt service 保存完整输出和 hash；
- `internal/executionreconciler` 独立拥有启动、取消和终态收敛状态机，`internal/runtimeassembly`
  按回答执行与个人记忆分别构造资源，唯一负责生产依赖组装、Temporal client、worker 注册及生命周期；reconciler 直接复用终态应用服务，依赖 application ports，
  不导入 Temporal SDK 或 HTTP；
- `apps/campus-search` 拥有检索领域合同、current-index PostgreSQL 读取、embedding 缓存、Qdrant 和 reranker adapter，以及 Campus Search HTTP service；
- execution-control 只通过 typed HTTP client 消费 Campus Search，保留 run admission、索引绑定、citation 和诊断投影；不拥有检索 provider 或本地 fallback。

## 进程入口

- `cmd/execution-api`：Deployment/Service 仍名为 `execution-control`，保留所有业务 HTTP 路由与 reconciler；不启动 poller。
- `cmd/execution-worker`：独立 Deployment，只启动 workflow、core activity、agent activity poller，
  HTTP 仅提供健康探针，不提供业务 Service 或 reconciler。两角色使用同一镜像 digest。
- Campus Search service 位于 `apps/campus-search/cmd/campus-search-service`，独立提供 Bot 公共搜索接口和
  execution-control 内部搜索接口；检索 provider 与当前 serving index 由该进程拥有。

API 的 `/readyz/process` 检查 draining 状态、run service 和执行数据库，作为 Kubernetes readiness；
原 `/readyz` 检查 draining 状态、执行数据库、Temporal poller 和 Agent Runtime，保留为聚合诊断。
未配置执行数据库时两个 readiness 接口均返回 503；不再输出未接入的本地限流容量或执行 registry 状态。
Worker 的 `/readyz` 检查本地 poller 生命周期和执行、个人记忆数据库；两个角色的 `/healthz` 都不检查
外部服务。readiness 继续使用现有内部鉴权。

API 收到 SIGTERM 后先撤销 readiness，由 `requestTracker` 拒绝新 HTTP 请求并保留既有请求的有界
排空，再由 API owner 停止 reconciler、关闭 store 与 Temporal starter；总退出上限 110 秒，Pod 宽限
120 秒。Worker 先撤销 readiness，再并行停止三类 poller，SDK 停机上限 350 秒，最后关闭共享依赖；
总退出上限 365 秒，Pod 宽限 390 秒，覆盖最长 330 秒的 core activity。
Worker 在独立的 `9090 /metrics` 输出 Temporal SDK 的 `temporal_worker_task_slots_used` 与
`temporal_worker_task_slots_available`，标签仅保留 `task_queue`、`worker_type`，供环境自动扩缩容消费。
指标不改变 readiness，也不把单 Pod slots 当作集群容量。
持久 start/cancel intent 和 invocation receipt 继续由新实例按既有合同收敛，不新增模型重试。

当前共享数据库 schema 由 `jobs/campus-agent-schema/` 安装，统一记录在
`drizzle.campus_agent_migrations`。运行时 Store 只连接和读写，不自动建表；PostgreSQL 集成测试也通过
该共享 Job 准备数据库，不再编译或调用应用自有 schema runner。

具体 HTTP 路径、字段和枚举不在 README 复制：

- 执行接口：`docs/contracts/tool-execution.md`；
- 个人记忆：`docs/architecture/system/memory-plane.md` 与 `docs/contracts/app-api/memory.md`；
- Model Config：`apps/model-config/README.md`、`docs/contracts/ops-web/providers.md` 与
  `docs/environment/providers.md`。

## 本地开发

`pnpm dev` 启动相同的 API 与 Worker 二进制；`pnpm --dir apps/execution-control dev:api` 和
`dev:worker` 可单独启动角色。先运行 `pnpm dev:init` 生成 API `PORT` 与 `EXECUTION_WORKER_PORT`。

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
