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

同一交付顺序必须先运行 `data-postgres` Application 中的 `campus-agent-schema` Job，再启动依赖数据库
的 workload。该 Job 使用 `campus_agent` owner 和统一 migration ledger；长期进程不执行 schema 迁移。
`ops-web-bootstrap` 只在自己的 wave 中执行 Dining 与班车 baseline bootstrap，不负责建表、迁移或授权。
个人记忆状态只通过 `execution_control.personal_memory_*` 表提供；历史 `runtime.*` 兼容 View 由统一
migration 退役，不是运行时接口。

发布检查：

- 环境仓 commit；
- root/child Application sync 与 health；
- `campus-agent-schema` Job 成功，并确认统一 ledger 已安装到目标数据库；
- 涉及旧对象清理的 migration 完成后，确认退役 View 不存在，底层表和既有运行角色 ACL 仍然存在；
- schema Job 已确认 `execution_control` 对所属 `execution_control` 表具有精确读写权限，且不具有 schema
  创建、表维护或 App API 产品终态表访问权限；
- Model Config、通知和 Dining 的运行角色只使用各自运行权限；Ops Web bootstrap 没有 DDL 或授权职责；
- first-party Deployment rollout 和不可变 image digest；
- 没有 `CrashLoopBackOff`、`ImagePullBackOff` 或无法解释的 `Pending` Pod。

具体集群命令只放环境仓 runbook，不在这里复制。

## 破坏性 Schema 变更

涉及删除表或列、重建数据，或不可逆转换的 execution-control schema 变更，只能在环境仓已隔离
私有连接器、暂停新的产品请求准入的维护窗口执行。Schema Job 仍是唯一的 DDL 入口；不得通过
常驻进程、手工数据库命令或伪造 migration ledger 绕过该合同。

## 开发环境 admission 快照硬切

本次删除 admission 内层 hash 的变更在本地 dev 与 staging 采用硬切：不支持旧运行跨版本续跑、
Activity receipt 恢复或 Temporal history replay；不引入双 hash、旧字段重建或兼容分支。
顶层 admission hash 继续覆盖完整快照，工具合同内容指纹仍保留。

切换时先暂停目标环境的新请求并停止旧 reconciler/worker，再终止该环境尚未关闭的旧回答 workflow。
清理对应开发请求的启动/取消意图、运行投影和 invocation receipts，并一并处理 app-api 未完成请求与
活动会话绑定，避免新实例恢复旧运行。已关闭历史可以保留查看，但不得重放或重新派发。
随后统一更新 app-api、execution-control 与 agent-runtime，以新请求验证完成、取消和重试。
清理仅覆盖已确认环境的开发回答数据，不清空共享数据库、Temporal namespace、模型配置或检索数据；
staging 的停止、数据处理与部署由环境仓执行。本条是此次发布边界，不新增长期数据生命周期机制。

## 数据库迁移边界

当前数据库拓扑由 `campus-agent-schema` 一次安装 execution-control、Model Config 和其他产品 schema
的最终结构。本次涉及的 execution-control、Model Config、Ops Web 和 notice-publisher 自有 schema runner、
旧 migration 目录及 legacy integration profile 已退役，不是标准本地 bootstrap 或 GitOps 的可执行入口。

统一 Job 不接管包含旧领域 ledger 或 `execution_config` 的数据库。已有 `drizzle.campus_agent_migrations`
的 v0 数据库由 Drizzle ORM RC.4 原位升级记录格式，按名称补跑遗漏 SQL；不会修改已应用 SQL。
具体环境是否已经应用某个 revision，以 GitOps 选择、schema Job 结果和统一
ledger 为准，不在本文保存一次性审计结果。不得通过双写、兼容 view 或第二条 ledger 延长已退役路径。

### 个人记忆遗漏迁移修复

旧时间戳 migrator 曾跳过 `personal_memory_management`：表现为 `profile.memory_commands.payload`
不存在（`42703`），或追加租约仍要求 `owner_sequence`（`23502`）。新 Job 的 `status` 应列出
`20260912000000_0015_personal_memory_management`，不能只用 ledger 条数或 Job 退出码判断。

这条 SQL 会清除旧记忆命令/来源/条目、关闭旧设置并删除退役列。发布前由环境仓暂停自动晋级，进入
维护窗口并停止目标环境的新请求、记忆写入和旧 worker；按 `memory-plane` 的范围清除本环境产品
bank、结束明确属于旧个人记忆的未完成 workflow，再选择新 schema image 执行 Job。不得删除全库或
整个 Temporal namespace，也不得伪造 ledger 把遗漏 SQL 标记为已执行。

Job 完成后用 `status` 确认 `current` 且 pending 为空，再恢复新版本服务和请求准入；开启记忆并通过
真实会话确认回答完成、后台 append 完成，以及记忆列表/召回/修改/停用/恢复可用。已完成此 SQL 的
本地数据库只升级 ledger，不重复清除记忆。SQL 已提交后的恢复不能仅回退应用镜像；需要按环境备份
恢复数据库及配套 bank，或继续向前修复。

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
`campus_docs_serving.current_index`。Publisher 复用 `EXECUTION_CONTROL_DATABASE_URL`，不创建第二个
数据库身份或连接。在线运行只从该绑定取得 collection；dimensions、查询指令和向量名由当前代码
提供，模型设置不重复保存这些索引属性。具体操作与清理条件见 `campus-docs.md`。

## 健康与排查

使用环境仓为当前环境提供的 app-api、campus-web 与 status-web 地址检查 `/readyz`，并确认响应中的
运行版本与环境选择一致；status-web 另检查 `/api/status` 能返回合同快照。源码仓不保存 staging
hostname。

execution-control readiness 降级时，根据顶层核心状态定位回答准入、Temporal、Agent Runtime、
PostgreSQL 或 execution runtime Application。`/readyz` 不探测 Model Config、Hindsight、Qdrant、
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

相关入口：`../architecture/system/durable-runtime.md`、`../architecture/system/k8s-runtime.md`、
`../contracts/tool-execution.md`、`temporal.md`、`release.md`。
