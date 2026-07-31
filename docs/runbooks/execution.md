---
doc_type: runbook
owner_boundary: execution-control
status: active
---

# 执行服务运维

## 边界

staging execution runtime 由 Kubernetes/GitOps 管理，Docker Compose 只用于本地诊断。环境仓
拥有 Application、namespace、rollout、恢复步骤和集群状态；本文只定义源码侧交接与排查入口。

## 部署交接

1. 源码工作流发布受影响的不可变 ARM64 runtime image；已有环境消费者的镜像进入环境
   PR，新镜像可以先发布候选版本再声明首个消费者；
2. 环境 CI 渲染并校验 Application、value、overlay 和加密 secret；
3. 合并环境 PR 选择 deployment revision；
4. Argo CD 按该 revision 对账。

同一 execution runtime Application 在 first-party Deployment 前运行低 wave 的 `Sync` schema
Job。Job 必须使用相同 execution-control image digest，安装并验证 run projection schema；长期进程不执行
schema 迁移。命令在执行 DDL 前最多等待 60 秒处理临时 PostgreSQL 连接错误；认证、TLS、权限、
SQL 和 schema 错误立即失败，DDL 本身不自动重放。

发布检查：

- 环境仓 commit；
- root/child Application sync 与 health；
- schema Job 返回 `passed=true`、`schema_ready=true`、`store=postgres`；
- schema Job 已确认 `execution_control` 对所属 `runtime` 表具有精确读写权限，且不具有 schema
  创建、表维护或 App API 产品终态表访问权限；
- first-party Deployment rollout 和不可变 image digest；
- 没有 `CrashLoopBackOff`、`ImagePullBackOff` 或无法解释的 `Pending` Pod。

具体集群命令只放环境仓 runbook，不在这里复制。

## 破坏性 Schema 变更

涉及删除表或列、重建数据，或不可逆转换的 execution-control schema 变更，只能在环境仓已隔离
私有连接器、暂停新的产品请求准入的维护窗口执行。Schema Job 仍是唯一的 DDL 入口；不得通过
常驻进程、手工数据库命令或伪造 migration ledger 绕过该合同。

## v5 单向切换

`tool_execution_v5` 冻结 `execution_strategy.v2`，并将获准的个人记忆召回改为模型按需调用的
`personal_memory_recall` 工具。它与 v4 输入和准入快照不兼容，必须作为同一个源码 revision
交付；不拆成双读/双写版本，也不保留 v4 fallback。Temporal 队列名仍为 `.v3`，它是
现有工作流队列身份，不等于应用执行合同版本。

### 切换前验证

1. 对同一源码 revision 完成合同生成检查、app-api migration 与产品数据库检查、
   execution-control Go/PostgreSQL 检查、受影响镜像构建和 Kubernetes render；
2. 在环境仓确认数据库备份/恢复责任、目标不可变 image digest、schema Job、app-api migration、
   execution-control Deployment 与 agent-runtime 均选择该 revision；确认 app-api 与 execution-control 已分别
   获得同一 `APP_API_EXECUTION_SHARED_SECRET` 引用；
3. 记录仍使用 v4 合同的开放 workflow、非终态 run、待准入产品请求和当前 poller，作为排空
   基线；
4. 若任一合同、migration 或 render 检查失败，不进入维护窗口。

### 维护窗口与 v4 run 排空

1. 在产品入口暂停新的聊天准入；已建立的浏览器连接可以继续读取，但不能创建新 v4 合同 run；
2. 保持旧 app-api dispatcher、execution-control 和当前 poller 可用，等待已接收请求完成产品
   finalization；不得先缩容或删除旧进程；
3. 持续核对 app-api 的 accepted/pending admission、execution-control 的非终态 run、Temporal
   开放 workflow、各旧队列 backlog 与 in-flight Activity；
4. 对维护窗口内不再等待的 run 使用既有显式取消路径，并等待取消也写入产品终态，不能只
   terminate Temporal history 或手改数据库；
5. 只有在 v4 合同开放 workflow、非终态 run、待投递请求和未完成产品 finalization 都为零后，才
   宣告排空完成。单独看到 queue backlog 为零不够。

若排空未完成，退出切换并恢复同一 v4 入口；这属于切换开始前中止，不是 v5 运行时 fallback。

### 启用 v5

1. 维持产品准入暂停，执行 app-api 与 execution-control 所属 schema migration，并核对 schema
   owner、版本与权限；
2. 部署同一 revision 的 app-api、execution-control 和 agent-runtime；execution-control 的三类 poller 必须使用
   分别为 `campus-agent.workflow.v3`、`campus-agent.activity.core.v3`、
   `campus-agent.activity.agent.v3`；
3. 确认每个 `.v3` 队列已有目标 poller，start/cancel reconciler 可租约并完成命令，内部输入
   API 使用 `APP_API_EXECUTION_SHARED_SECRET` 完成读取 smoke，readiness 正常；缺少或
   误用该 Secret 时不得恢复准入；
4. 关闭旧 poller 和旧配置，确认没有组件在同一服务边界同时读取 v4/v5 payload；
5. 恢复产品准入。第一个 v5 请求被接受后，切换成为单向事实，故障只能在 v5 合同上向前修复，
   不得恢复旧 parser、旧列读取或旧工具语义。

### 验收证据

使用非敏感合成请求逐项验证：

- `request.accepted` 提供稳定 `runId`，但不合成未观察到的 `execution.queued`；
- run 与 start command 同时持久化，reconciler 使用 `campus-agent.chat.{runId}` 启动一次 workflow；
- 断开 POST stream 后按 `next_sequence` 恢复同一 run；游标能跨过只有内部事件的区间；
- 显式取消先落 app-api 发件箱，最终得到产品取消终态和浏览器 `run.canceled`；
- 完成与取消的重复 closeout 保持同一 fingerprint，较晚的不同终态不能覆盖；
- Temporal history 可包含有界 grounding 与 Agent result；execution-control metadata/event/step、应用日志和
  trace 不含合成 prompt、对话、工具原始载荷或认证材料；
- 已经分配 run 的 app-api 执行输入在完成、失败、取消和超时后仍可按同一 ref/hash 读取，不存在
  execution-control 清理记录或释放回调；
- start RPC 前已经持久化 `dispatch_attempted`；该 fence 只裁决启动和取消，不控制执行输入生命周期；
- Primary Agent 的故障注入结果与源码测试一致：已有 `started` 或 `completed` receipt 但没有可用
  Activity result 时关闭为 `agent_attempt_uncertain`，不产生第二次供应商调用；
- 当前新运行不含 `selected_tool` 或 handoff。关闭个人记忆召回时 `visible_tool_names` 和
  `available_tools` 为空；允许召回时只包含 `personal_memory_recall`，工具轨迹最多产生一次对应 SDK
  调用；
- 准入快照包含 `student_rules`、`institutional_rules`、`curriculum` 的 current release、物理 Qdrant
  collection，以及 `llm` 和检索路径 `embedding` 模型设置 hash；
- Temporal 顺序包含 `grounding.prepare`、`agent.primary`、`finalization.write` 和 `memory.append`；完整
  grounding 正文经由 workflow history 传递，知识问题不产生 SDK tool call。

环境完成证据至少包括环境仓选择的 commit、Argo CD sync/health、schema/migration 结果、三个
`.v3` 队列的 v5 poller 与 backlog、旧 workflow 排空记录和合成请求关联标识。源码 CI、本地
render、Deployment 清单或队列配置存在都不能证明 staging/production 已切换。

### 故障处理

schema migration 或 v5 部署开始后保持准入暂停，优先修复并重新部署同一 v5 合同。不要通过
恢复 v4 读取、双写、旧工具语义、手工插入终态或删除 Temporal history 恢复服务。数据库
灾难恢复只按环境仓既有流程整体执行，不能作为应用级回滚捷径。
在线回答不支持 Temporal Reset；若必须进行管理面恢复，先停止产品准入并由应用所有者制定独立数据
恢复方案，不能把 Reset 当成普通重试。应用会拒绝把 Reset successor 重新绑定到原产品 run。

## 配置和 Secret

非敏感部署参数由环境仓 ConfigMap 提供，secret 由环境选择的 secret backend 注入。队列名、超时、
并发上限和 RAG 限制等产品常量由源码拥有，不作为环境变量重复维护。私有
registry 的 pull secret 由环境 overlay 绑定到 first-party ServiceAccount。

在线模型配置由 execution-control 管理。runtime 与同一 Deployment 的 admin 监听器使用一个
`EXECUTION_CONTROL_DATABASE_URL` 和 Provider Config keyring，admin 监听器另用 `OPS_WEB_INTERNAL_TOKEN`
鉴权；缺少 LLM、Embedding、数据库或可解密 key 都是部署阻塞项。Hindsight 与 eval provider
配置不进入 execution 配置数据库。

## 健康与排查

使用环境仓为当前环境提供的 app-api 与 campus-web 地址检查 `/readyz`，并确认响应中的运行版本
与环境选择一致。源码仓不保存 staging hostname。

execution-control readiness 降级时，根据顶层核心状态定位回答准入、Temporal、Agent Runtime、
PostgreSQL 或 execution runtime Application。Provider Config、Hindsight、Qdrant、OTel 和工具读取
投影状态是局部能力诊断，不单独阻断顶层 readiness。通过环境仓修复期望状态，
不以本地 Docker、临时环境渲染器或宿主机修改代替 GitOps。

`run_projection_store` 与 `personal_memory_runtime` 的 PostgreSQL 健康检查会使用常驻运行角色实际
读取所属表。出现 SQLSTATE `42501` 时，应修复并重新发布 schema Job 所有的精确授权；不得切回
schema owner DSN、手工在线 `GRANT`、扩大到 `runtime` 全表权限或直接修改运行数据。部署验收还需
确认 start、cancel reconciler 不再产生新的 `42501`，并处理既有命令，不以 readiness
单项恢复代替业务收敛证据。

相关入口：`../architecture/system/durable-runtime.md`、`../architecture/system/k8s-runtime.md`、
`../contracts/tool-execution.md`、`temporal.md`、`release.md`、`e2e.md`。
