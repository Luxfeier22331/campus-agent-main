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

同一交付顺序必须先运行低 wave 的 execution-control `Sync` schema Job，再运行 Model Config schema
Job，最后启动依赖它们的 workload。两个 Job 分别使用同 revision 的所属镜像；长期进程不执行 schema
迁移。execution-control 命令在执行 DDL 前最多等待 60 秒处理临时 PostgreSQL 连接错误；认证、TLS、
权限、SQL 和 schema 错误立即失败，DDL 本身不自动重放。

发布检查：

- 环境仓 commit；
- root/child Application sync 与 health；
- schema Job 返回 `passed=true`、`schema_ready=true`、`store=postgres`；
- schema Job 已确认 `execution_control` 对所属 `execution_control` 表具有精确读写权限，且不具有 schema
  创建、表维护或 App API 产品终态表访问权限；
- Model Config schema Job 已完成独立 schema/role 安装；维护窗口切换时还需确认旧模型设置已事务迁移，
  且 execution-control 和 Ops Web 均无 `model_config.model_configs` 数据库权限；
- first-party Deployment rollout 和不可变 image digest；
- 没有 `CrashLoopBackOff`、`ImagePullBackOff` 或无法解释的 `Pending` Pod。

具体集群命令只放环境仓 runbook，不在这里复制。

## 破坏性 Schema 变更

涉及删除表或列、重建数据，或不可逆转换的 execution-control schema 变更，只能在环境仓已隔离
私有连接器、暂停新的产品请求准入的维护窗口执行。Schema Job 仍是唯一的 DDL 入口；不得通过
常驻进程、手工数据库命令或伪造 migration ledger 绕过该合同。

## execution_control 历史 schema 与 Model Config 切换

Goose v4 至 v9 是不可改写的 execution-control 历史：它们曾把运行表与 `model_settings` 移到
`execution_control`，并演进 Campus Docs 当前索引合同。这些 migration 在新数据库也必须先完整执行；
它们不表示当前常驻 execution-control 仍拥有模型配置。随后 Model Config schema 命令接管当前 config，
因此首次切换不能按普通无停写滚动升级处理。

环境交付按以下顺序执行：

1. 暂停新的产品请求准入，等待 execution-control PostgreSQL 写入排空；Temporal 服务和 workflow
   history 保持可用，不删除或重置开放 workflow；
2. 在旧 writer 已停止后运行新 image 的 `run-projection-schema --mode install`，确认全部历史 Goose
   migration 已应用、execution-control 投影保留已有行、外键和索引；该 Job 只把旧 Provider Config
   密钥作为历史 migration 输入；
3. 运行同一 revision 的 `model-config-schema`，使用新 Model Config 密钥和旧 Provider Config 密钥，
   事务性解密、冲突校验、重加密并写入 `model_config.model_configs`，成功后删除旧
   `execution_control.model_settings` 及兼容 view；任一步失败都保持旧数据不变；
4. 部署 Model Config、execution-control、Agent Runtime、Ops Web 和其他受影响 consumer，确认各自
   readiness、target/hash/完整配置读取、start/cancel reconciler、个人记忆状态和 Ops Web 精确列读取；
5. 恢复产品准入，并观察新写入只进入所属 schema；不得恢复旧模型配置 writer、双写或兼容读取；
6. 只有所有活跃环境都完成上述切换且查询证据不再引用旧运行投影视图后，才追加 migration 删除兼容
   视图及空的 `execution_config` schema。删除兼容对象不能与首次切换放在同一发布中。

迁移事务失败时保持准入暂停并修复后重跑所属 schema Job。切换成功且新 writer 已恢复后，按新
schema 向前修复；不能把旧构建当作应用回滚。旧 `model_settings` 密文的 AAD 只用于切换时解密，
Model Config 会使用自己的 AAD 与密钥重加密。

## 配置和 Secret

非敏感部署参数由环境仓 ConfigMap 提供，secret 由环境选择的 secret backend 注入。队列名、超时、
并发上限和 RAG 限制等产品常量由源码拥有，不作为环境变量重复维护。私有
registry 的 pull secret 由环境 overlay 绑定到 first-party ServiceAccount。

在线模型配置由独立 Model Config 管理。单一 listener 默认监听 `8000`，与内部 consumer 位于共同
受信任边界，不使用额外 consumer token 或按 name 的权限矩阵。LLM、Reranker 与通知分类目标可在线
替换；Campus Docs Embedding 只允许替换 Base URL 和 API key，固定 model、protocol 和 2560 维向量空间
由 Campus Docs 合同拥有。缺少数据库、可解密 Model Config key 或所属 config 时，对应管理或消费路径
失败关闭。Hindsight 与 eval provider 配置不进入 Model Config。

Campus Docs 的三个索引 Job 由人工分别触发。Embedding Job 从 Model Config 一次读取
`campus_docs_embedding` 完整配置；Embedding Set v3 记录响应中的 target hash。
Publisher 只消费显式 chunk/embedding 制品并在完整校验 Qdrant collection 后替换
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
