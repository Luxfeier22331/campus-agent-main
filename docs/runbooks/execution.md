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
- schema Job 已确认 `execution_control` 对所属 `execution_control` 表具有精确读写权限，且不具有 schema
  创建、表维护或 App API 产品终态表访问权限；
- first-party Deployment rollout 和不可变 image digest；
- 没有 `CrashLoopBackOff`、`ImagePullBackOff` 或无法解释的 `Pending` Pod。

具体集群命令只放环境仓 runbook，不在这里复制。

## 破坏性 Schema 变更

涉及删除表或列、重建数据，或不可逆转换的 execution-control schema 变更，只能在环境仓已隔离
私有连接器、暂停新的产品请求准入的维护窗口执行。Schema Job 仍是唯一的 DDL 入口；不得通过
常驻进程、手工数据库命令或伪造 migration ledger 绕过该合同。

## execution_control schema 与 Campus Docs 切换

Goose v4 会把 execution-control 拥有的 12 张运行表和 `model_settings` 原位移动到
`execution_control`；v5 新建 `campus_docs_serving.current_index`，v6 删除模型设置中与索引重复的
dimensions、space 和当前索引中的 provider/model 字段，v7 将现有 Embedding 设置规范为固定
provider、model 和 transport，并标记为需要重新验证。迁移后源码只读写新路径；`runtime` 和
`execution_config` 下的同名对象是临时只读视图，不能承接旧构建的 `INSERT ... ON CONFLICT` 或其他
DML。因此该版本不能按普通无停写滚动升级处理。

环境交付按以下顺序执行：

1. 暂停新的产品请求准入，等待 execution-control PostgreSQL 写入排空；Temporal 服务和 workflow
   history 保持可用，不删除或重置开放 workflow；
2. 在旧 writer 已停止后运行新 image 的 `run-projection-schema --mode install`，确认 v4 至 v7 已
   应用、13 张 execution-control 表保留已有行、外键和索引，Campus Docs 当前索引表已创建，并确认
   旧路径只能读取；
3. 部署同一 revision 的 execution-control 与 Ops Web，确认 Store 健康、Provider Config 解密、
   start/cancel reconciler、个人记忆状态和 Ops Web 精确列读取；
4. 恢复产品准入，并观察新写入只进入 `execution_control`；不得恢复旧 writer、双写或通过旧视图写入；
5. 只有所有活跃环境都完成上述切换且查询证据不再引用旧路径后，才追加 migration 删除 13 个兼容
   视图及空的 `execution_config` schema。删除兼容对象不能与首次切换放在同一发布中。

迁移事务失败时保持准入暂停并修复后重跑同一 schema Job。迁移成功且新 writer 已恢复后，按新
schema 向前修复；不能把旧构建当作应用回滚。`model_settings` 密文继续使用
`execution_config.model_settings:<kind>` 这一 AAD v1，schema 移动不重加密。

## 配置和 Secret

非敏感部署参数由环境仓 ConfigMap 提供，secret 由环境选择的 secret backend 注入。队列名、超时、
并发上限和 RAG 限制等产品常量由源码拥有，不作为环境变量重复维护。私有
registry 的 pull secret 由环境 overlay 绑定到 first-party ServiceAccount。

在线模型配置由 execution-control 管理。LLM 和通知分类的 provider、model、transport 可在线替换；Embedding
只允许在线替换 Base URL 和 API key，固定向量空间合同由源码和当前索引共同拥有。runtime 与同一 Deployment 的 admin 监听器使用一个
`EXECUTION_CONTROL_DATABASE_URL` 和单一 Provider Config `encryption.key`，admin 监听器另用
`OPS_WEB_INTERNAL_TOKEN` 鉴权；缺少数据库或可解密 key 会使配置管理不可用，具体模型缺失由对应消费路径
处理。Hindsight 与 eval provider
配置不进入 execution 配置数据库。

Campus Docs 的三个索引 Job 由人工分别触发。Embedding Job 从 execution-control 读取一次当前
Embedding 连接，Publisher 只消费显式 chunk/embedding 制品并在完整校验 Qdrant collection 后替换
`campus_docs_serving.current_index`。在线运行从该绑定取得 dimensions、space、查询指令和 collection；
模型设置不重复保存这些索引属性。具体操作与清理条件见 `campus-docs.md`。

## 健康与排查

使用环境仓为当前环境提供的 app-api、campus-web 与 status-web 地址检查 `/readyz`，并确认响应中的
运行版本与环境选择一致；status-web 另检查 `/api/status` 能返回合同快照。源码仓不保存 staging
hostname。

execution-control readiness 降级时，根据顶层核心状态定位回答准入、Temporal、Agent Runtime、
PostgreSQL 或 execution runtime Application。`/readyz` 不探测 Provider Config、Hindsight、Qdrant、
OTel 或工具读取投影；这些局部能力由所属管理接口、业务路径、metrics 和 trace 提供故障证据。通过
环境仓修复期望状态，不以本地 Docker、临时环境渲染器或宿主机修改代替 GitOps。

`run_projection_store` 的就绪检查会使用常驻运行角色实际读取所属表；个人记忆状态表权限由 schema
Job 验证，并由实际记忆 Activity 的错误暴露。出现 SQLSTATE `42501` 时，应修复并重新发布 schema
Job 所有的精确授权；不得切回 schema owner DSN、手工在线 `GRANT`、扩大到 `runtime` 全表权限或
直接修改运行数据。部署验收还需确认 start、cancel reconciler 和记忆 Activity 不再产生新的
`42501`，并处理既有命令，不以 readiness 单项恢复代替业务收敛证据。

相关入口：`../architecture/system/durable-runtime.md`、`../architecture/system/k8s-runtime.md`、
`../contracts/tool-execution.md`、`temporal.md`、`release.md`、`e2e.md`。
