---
doc_type: runbook
owner_boundary: agent-control
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

同一交付顺序必须先完成数据库 role 预置，再运行 `data-postgres` Application 中的
`campus-agent-schema` Job，最后启动或滚动依赖数据库的 workload。该 Job 使用 `campus_agent` owner
和统一 migration ledger；长期进程不执行 schema 迁移。

Agent Control 的 PostgreSQL role 已从 `execution_control` 切换到 `agent_control`，旧 role 的授权由
`20261018120000_revoke_execution_control` 回收，环境仓随后删除该 role 及旧 Secret；切换过程见
[PostgreSQL 所有权](../../data/postgres-ownership.md#agent-control-role-切换)。

不要把旧 role 删除声明与 schema migration 放在同一次跨 Application 同步中；sync wave 只在单个
Application 内排序，不能替代环境仓的阶段切换。
`ops-web-bootstrap` 只在自己的 wave 中执行 Dining 与班车 baseline bootstrap，不负责建表、迁移或授权。
独立 Memory 数据库由同一 schema 制品的 `--target memory` 入口安装，`memory-schema` Job 使用
`memory_service` role；个人记忆状态经 Memory API 消费，部署不再从旧 execution 表复制状态。

### GitOps 配置交接检查

源码 promotion 只会更新 Source revision、镜像 digest、发布标识和应用 source SHA，不会自动重命名
SealedSecret、ConfigMap 或其中的 key。环境仓在选择包含本次合同切换的 Source SHA 前，必须完成以下期望状态：

- `agent-control-read-model-secrets` 提供 `AGENT_CONTROL_DATABASE_URL`；
- `agent-control-ingress-secrets` 提供 `AGENT_CONTROL_INGRESS_SHARED_SECRET`；
- Agent Control 和 Memory 的 ConfigMap 使用
  `AGENT_CONTROL_PRODUCT_CALLBACK_BASE_URL`、`AGENT_CONTROL_TEMPORAL_ADDRESS` 和
  `AGENT_CONTROL_TEMPORAL_NAMESPACE`；Agent Runtime 与相关 publisher 按各自 workload 实际消费提供
  `AGENT_CONTROL_TEMPORAL_ADDRESS` 和 `AGENT_CONTROL_TEMPORAL_NAMESPACE`；
- 配置/Secret 与 schema Job、workload rollout 位于环境仓定义的同一切换流程中，并在 schema Job 前完成旧
  消费者排空。跨 child Application 的 sync wave 不能替代这一顺序。

其余内部配置按实际 owner 同步切换：

| 消费方 | 当前 Secret / key |
| --- | --- |
| Control 与 Runtime | `agent-control-runtime-secrets/AGENT_CONTROL_RUNTIME_SHARED_SECRET` |
| App API、Control 与 Memory 回调 | `app-api-internal-secrets/APP_API_INTERNAL_SHARED_SECRET` |
| Memory API/Worker | `memory-service-secrets/HINDSIGHT_OWNER_SALT` |
| Campus Search 与 Notice Artifacts | ConfigMap `campus-agent-qdrant-tls-ca` |

App API 执行输入读取与产品回调继续共享同一个原值，HTTP 认证 header 不变。Memory owner salt 必须原值
迁移，不重新生成。Secret 名称变更必须使用 strict scope 重新封装，不能直接改密文对象的 metadata。
发布窗口内由 GitOps 暂时保留旧 Secret/CA；新消费者全部切换、旧连接清零后在环境仓删除。
GitOps 的凭据投递镜像与 Worker 配置生成器也必须支持新 key，再由投递 Job 更新 GitOps Environment。

当前 Runtime Worker 只声明 HTTP 健康端口，没有原 execution-worker/HTTP Runtime 的 metrics 合同。
GitOps 移除无人消费的 scrape、recording rules、runtime-metrics 与 KEDA；当前 workload 保持固定副本。

发布检查：

- 环境仓 commit；
- GitOps Secret/ConfigMap 名称和 key 已符合上面的新合同，promotion 未被误认为会自动完成重命名；
- root/child Application sync 与 health；
- `agent_control` role 已预置；
- 受影响的新请求已暂停，旧消费者已排空或停止，且旧数据库连接已清零；
- `campus-agent-schema` Job 成功，并确认统一 ledger 已安装到目标数据库；
- 涉及旧对象清理的 migration 完成后，确认退役 View 不存在，底层表和既有运行角色 ACL 仍然存在；
- schema Job 已确认 `agent_control` 对所属 `agent_control` 表具有精确读写权限，且不具有 schema
  创建、表维护或 App API 产品终态表访问权限；
- Model Config、通知和 Dining 的运行角色只使用各自运行权限；Ops Web bootstrap 没有 DDL 或授权职责；
- first-party Deployment rollout 和不可变 image digest；
- 没有 `CrashLoopBackOff`、`ImagePullBackOff` 或无法解释的 `Pending` Pod。

具体集群命令只放环境仓 runbook，不在这里复制。

## Agent 与 Memory 独立部署

Agent 编排固定进入 agent-runtime 的 TypeScript `AgentWorkflow`；agent-control 拥有准入、取消、
运行投影和结果投递。Memory API/Worker 使用独立数据库及 Workflow，Hindsight 拥有记忆内容。
旧 Go Worker、HTTP Runtime 和一次性状态复制工具已删除，不提供比例切流或旧 history 恢复入口。

1. 新环境先通过 `campus-agent-schema migrate --target memory` 初始化独立数据库；已有环境沿用
   `memory` 数据库、`memory_service` role、owner salt 和 Hindsight bank，不重复复制或重置记忆。
2. GitOps 按 Source 合同选择 Agent Control、Agent Runtime、Memory 和私有入口各自的 base 与镜像。
   内部 recall 由 Runtime 直接调用 Memory，回答追加由 Control 持久投递给 Memory。
3. Memory API/Worker 就绪后，由 PostSync `memory-config-upgrade` 更新已有 Hindsight 配置和画像。
   配置一致时跳过；失败保留 Job，修复具体原因后重新同步。行为与配置见
   [Memory 服务](../../../apps/memory-service/README.md#hindsight-配置升级)。
4. 验证 Application 的 sync/health、Agent 队列 poller，以及真实回答、取消、记忆读取和追加终态。
   配置升级还需确认新画像内容，不能只凭模型回复或 Job 启动判断成功。

当前数据库状态与 Hindsight bank 由独立 Memory 服务维护。后续发布不再使用旧合并进程、旧队列
或过期迁移源作为回退路径；恢复使用环境仓选择的当前架构制品和相应数据恢复流程。

## 破坏性 Schema 变更

主库本次新增迁移只删除已无运行消费者的三张 `agent_control.personal_memory_*` 状态表，
不删除 `profile.memory_commands` 或 `agent_control.agent_memory_deliveries`，不连接独立 Memory
数据库。Schema Job 仍是唯一的 DDL 入口；不修改历史迁移，不重跑旧状态复制。
已退役表的删除无需引入产品维护模式；仍被当前进程使用的表列变更另按实际消费者安排交付。

## 运行时聚合拆分交付

Source 新增 `campus-search/base` 与 `notice-pipeline/base`，Model Config 使用已有独立 base。
GitOps 分别创建 Application，保持 Deployment、Service、队列和数据库角色身份不变。
Ops Web 的 Temporal 地址与 namespace 由自己的 ConfigMap 提供。

GitOps 已将这些资源接管到各自 Application，Source 随后删除了旧 `execution-runtime` 聚合 base。

结果归一化搬迁同时改变合成结果合同：新版 Runtime 提交 evidence/source attempts，Control 只保存。
旧 Control 拒绝这种提交；旧 Runtime 提交给新 Control 又会缺少合成材料。本轮两者必须配对更新，
在无旧 Workflow 的交付窗口完成两个 rollout 后再发起新会话，不增加长期兼容路径。

## 数据库迁移边界

当前数据库拓扑由 `campus-agent-schema` 一次安装 agent-control、Model Config 和其他产品 schema
的最终结构。agent-control、Model Config、Ops Web 和 notice-publisher 自有 schema runner、
旧 migration 目录及 legacy integration profile 已退役，不是标准本地 bootstrap 或 GitOps 的可执行入口。

统一 Job 不接管包含旧领域 ledger 或 `execution_config` 的数据库。已有 `drizzle.campus_agent_migrations`
的 v0 数据库由 Drizzle ORM RC.4 原位升级记录格式，按名称补跑遗漏 SQL；不会修改已应用 SQL。
具体环境是否已经应用某个 revision，以 GitOps 选择、schema Job 结果和统一
ledger 为准，不在本文保存一次性审计结果。不得通过双写、兼容 view 或第二条 ledger 延长已退役路径。

## 配置和 Secret

非敏感部署参数由环境仓 ConfigMap 提供，secret 由环境选择的 secret backend 注入。队列名、超时、
并发上限和 RAG 限制等产品常量由源码拥有，不作为环境变量重复维护。私有
registry 的 pull secret 由环境 overlay 绑定到 first-party ServiceAccount。

在线模型配置由独立 Model Config 管理。单一 listener 默认监听 `8000`，与内部 consumer 位于共同
受信任边界，不使用额外 consumer token 或按 name 的权限矩阵。LLM、Reranker 与通知分类目标可在线
替换；Campus Docs Embedding 只允许替换 Base URL 和 API key，固定 model、protocol 和 2560 维向量空间
由 Campus Docs 合同拥有。缺少数据库、可解密 Model Config key 或所属 config 时，对应管理或消费路径
失败关闭。Hindsight 与 eval provider 配置不进入 Model Config。

Campus Docs 与 Notices 的 Chunk/Embedding Job 由人工分别触发。两个 Embedding Job 从 Model Config 一次
读取 `campus_docs_embedding` 完整配置；各自 Embedding Set 记录响应中的 target hash。统一 Publisher 只
消费显式 Docs/Notice chunk/embedding 制品，在完整校验混合 Qdrant collection 后替换
`campus_docs_serving.current_index`。Publisher 复用 `AGENT_CONTROL_DATABASE_URL`，不创建第二个
数据库身份或连接。在线运行只从该绑定取得 collection；dimensions、查询指令和向量名由当前代码
提供，模型设置不重复保存这些索引属性。具体操作与清理条件见 [Campus Docs 与 Notices 维护及统一 RAG 发布](../ingestion/campus-docs.md)。

## 健康与排查

使用环境仓为当前环境提供的 app-api、campus-web 与 status-web 地址检查 `/readyz`，并确认响应中的
运行版本与环境选择一致；status-web 另检查 `/api/status` 能返回合同快照。源码仓不保存 staging
hostname。

Kubernetes 使用 API `/readyz/process`，原 `/readyz` 保留聚合诊断。聚合 readiness 降级时，检查 API
是否正在 draining，并根据核心状态定位 Temporal、Agent Runtime 或执行 PostgreSQL；未配置执行
数据库也会返回不就绪。`/readyz` 不探测 Model Config、Hindsight、Qdrant、
OTel 或工具读取投影；这些局部能力由所属管理接口、业务路径、metrics 和 trace 提供故障证据。通过
环境仓修复期望状态，不以本地 Docker、临时环境渲染器或宿主机修改代替 GitOps。

Model Config readiness 会实际读取 config 并解密所有已存密钥；该检查通过只证明当前进程可访问并
解密数据库内容，不证明外部 Provider 可用。目标变更后的 Primary Agent 请求若携带旧 hash，完整配置
接口返回冲突，consumer 必须重新准入，不能静默采用新目标。

`run_projection_store` 的就绪检查会使用常驻运行角色实际读取所属表；个人记忆状态表权限由 schema
Job 验证，并由实际记忆 Activity 的错误暴露。出现 SQLSTATE `42501` 时，应修复并重新发布 schema
Job 所有的精确授权；不得切回 schema owner DSN、手工在线 `GRANT`、扩大到 `runtime` 全表权限或
直接修改运行数据。部署验收还需确认 start、cancel reconciler 和记忆 Activity 不再产生新的
`42501`，并处理既有命令，不以 readiness 单项恢复代替业务收敛证据。

相关入口：[持久 Agent 运行时](../../architecture/system/durable-runtime.md)、[Kubernetes 运行时](../../architecture/system/k8s-runtime.md)、
[执行合同](../../contracts/tool-execution.md)、[Temporal 自托管运维](./temporal.md)、[发布](../release/release.md)。

## Cluster private ingress 与 Worker 发布

GitOps 负责 Worker 构建、环境配置、版本上传和流量选择。Source 发布受影响镜像与候选计划，
异步触发 GitOps；Source Environment 不再保存 Worker 发布凭据或 VPC 配置。

1. GitOps 维护 `cluster-private-ingress-secrets/EDGE_INGRESS_SHARED_SECRET`、Control 入站凭据和
   `memory-service-secrets/MEMORY_INTERNAL_SHARED_SECRET`。入口持有后端凭据并按固定路由转换认证；
   Worker 使用入口凭据，产品回调和 Object Store 保留各自当前合同。
2. Cloudflare VPC Service 指向 `cluster-private-ingress:8000`。connector 连接入口，入口连接
   Control/Memory；connector 不直接访问这两个后端，Object Store 使用独立通道。
3. GitOps staging 提供 `CLUSTER_PRIVATE_VPC_SERVICE_ID` 与 `EDGE_INGRESS_SHARED_SECRET`，
   按精确 Source SHA 构建并发布 Worker。`CLUSTER_PRIVATE_ORIGIN` 与环境内入口 Service 地址一致。
4. 后端 Application 就绪后，由 GitOps 选择 Worker 流量。验证真实聊天创建、事件读取、完成与取消，
   以及 Memory 画像读取、命令状态和对话追加。记忆写入完成以 Memory 命令或追加终态为准。

运行时通信边界见[集群私有入口](../../../apps/cluster-private-ingress/README.md)；环境发布操作由
GitOps 的交付文档维护。共享凭据以 GitOps SealedSecret 为来源，GitOps Environment 保存 runner
消费副本，不向 Source 恢复旧发布配置。
