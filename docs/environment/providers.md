---
doc_type: reference
owner_boundary: docs/environment
status: active
---

# Provider 与 Secret

## 文档边界

本文登记供应商类别、消费方、配置所有者和凭据边界。精确环境变量由应用模板和配置解析器
维护，在线当前值由运行配置维护，部署 Secret 名和地址由 workload manifest 与环境仓
维护。

`.env.example` 不是 staging 或 production 的 Secret 清单，ConfigMap、Secret 和平台变量也不
替代在线模型配置、Hindsight 内部配置或评测运行配置。

## 模型与检索

| 能力 | 配置所有者 | 消费方 | 合同 |
| --- | --- | --- | --- |
| Primary Agent | Model Config 的 `primary_agent` config | agent-control、agent-runtime | 准入冻结 target hash；Agent Runtime 按该 hash 读取完整配置 |
| Embedding 连接 | Model Config 的 `campus_docs_embedding` config | Campus Docs 与 Notice Embedding Job | Job 一次读取完整配置；Ops Web 只替换 Base URL 和 API key，provider、model 和 protocol 由共享 canonical embedding 合同拥有 |
| Reranker 连接 | Model Config 的 `campus_docs_reranker` config | Campus Search service 的 `campus_search` | Cohere Rerank provider/protocol 由该具名配置约束；离线实验继续使用独立本地 profile |
| 通知分类连接 | Model Config 的 `notice_classification_decision` 与 `notice_classification_llm` config，`notice_classification` 别名指向当前后端 | notice-classifier 在线 Job | Job 启动阶段一次读取别名解析出的完整配置；API key 不返回浏览器 |
| 个人记忆 LLM、Embedding、RRF | 环境仓的 Hindsight Helm 配置 | Hindsight | 不从 execution 配置、Ops Web 或评测配置派生 |
| 评测模型 | 评测命令运行环境 | Inspect 评测命令 | 不复用在线配置数据库或浏览器凭据 |

Embedding Job 在启动后从 Model Config 一次读取完整配置并直接调用 provider。系统不为索引构建维护
第二份 provider 配置。Embedding provider 固定为 `openai-compatible`，model 固定为
`Qwen3-Embedding-4B`，transport
固定为 `embeddings`；设置验证观测到的向量长度不是可编辑索引配置。实际 dimensions、
`embedding_space_id`、查询指令和向量名来自显式 embedding/index 制品及发布器代码。Primary Agent 与
agent-runtime 不直接读取 Embedding 连接、Qdrant 或 `campus_docs_serving.current_index`；Campus Search service
读取这些运行时依赖；agent-runtime 工具 Activity 通过内部 HTTP 消费检索结果，agent-control 仅保存投影。

具体模型、transport 和 endpoint 由当前模型设置、索引制品与可执行注册表维护，不在本文复制。

通知分类 Job 在启动分类阶段后读取一次 `notice_classification` runtime config，直接调用其中的
protocol（决策模型为 System One 接口 `typesafe.systemone`，供应商 Nace Drex 或 TypeSafe Jev；LLM 为 OpenAI 兼容接口）。两家后端的模型名、provider、Base URL 和
API key 各存一份，当前后端由 Ops Web 通过 Model Config 的别名选择切换；
本地 `pnpm --dir jobs/notice-classifier classify:local` 通过端口转发读取同一份 Model Config，不保存模型连接。
评测 `pnpm --dir jobs/notice-classifier classify:eval` 按存储名读取某一家的配置做离线比较，不改 Ops Web 的选择。

## 数据服务

### PostgreSQL

PostgreSQL 角色按数据所有权、授权范围和迁移边界决定，不按应用或 Job 名称自动拆分。连接拓扑与
角色边界见 [PostgreSQL 所有权](../data/postgres-ownership.md)，不得为了减少 Secret 数量合并成超出职责的高权限账号。

### Qdrant

统一 Campus RAG Publisher 使用维护凭据创建、校验和发布包含 Docs/Notice point 的 collection；
Campus Search service 在线查询使用只读 Qdrant 凭据；agent-control 不再持有 Qdrant 凭据。Docs/Notice builder
不需要 Qdrant 凭据。

### 对象存储

来源和派生产物使用 S3-compatible 接口及按 bucket、prefix 和操作范围限制的凭据。应用只获得
直接消费对象所需权限；对象存储品牌不进入数据合同。Kubernetes 内的写入者使用各自 S3 凭据；
App API 的 Dining SVG 资源接口通过 Workers VPC binding 访问明确前缀；通知图片和投稿照片则经
同一私有通道发送 S3 签名请求，分别使用只读身份和 derived 写身份。

对象存储管理身份在 Kubernetes Secret 中使用 `OBJECT_STORE_ADMIN_ACCESS_KEY` 和
`OBJECT_STORE_ADMIN_SECRET_KEY`。部署清单只在 RustFS 容器边界把它们映射为
`RUSTFS_ACCESS_KEY` 和 `RUSTFS_SECRET_KEY`；应用身份继续使用 source/derived 各自的
`OBJECT_STORE_*` 键。供应商名称不进入 Secret 的稳定键名。

Dining 投稿复用现有 `campus-agent-derived` bucket、derived 写身份与只读身份，不新建存储服务、
bucket 或投稿专用凭据。两组身份各有 access key 和 secret key；Kubernetes Secret、GitHub Environment
和 Worker Secret 是同一身份的不同交付位置，不代表需要分别生成账号或密钥。

| 身份 | 凭据名称 | 消费者与交付位置 |
| --- | --- | --- |
| derived 读写 | `OBJECT_STORE_DERIVED_ACCESS_KEY`、`OBJECT_STORE_DERIVED_SECRET_KEY` | 既有 Kubernetes 写入者；同值同步到 GitOps GitHub `staging` Environment，由 App API candidate 上传脚本交付为 Worker Secret |
| derived 只读 | `OBJECT_STORE_DERIVED_READ_ACCESS_KEY`、`OBJECT_STORE_DERIVED_READ_SECRET_KEY` | GitOps 快照准备及 App API 通知图片读取；Ops 图片代理通过既有 `object-store-secrets` 注入同一只读身份 |

GitOps `staging` Environment 是共享凭据的投递入口；`secrets.yml` 的 `all` 流程先生成 SealedSecret PR，
合并并完成 Argo CD 同步后再投递 GitOps `staging`。已有凭据只补交付位置，不因增加消费者重新生成。
精确上传要求见 GitOps 的 `tools/resolve-workers.ts`，缺少要求的
Secret 会阻止 candidate 上传。Ops 图片代理复用现有 endpoint 与 bucket 配置；缺少只读凭据时
仅图片读取不可用，文字治理仍可运行，不使用 derived 写身份代替。

投稿继续使用既有 `campus-agent-derived-rw` 策略。原策略具有 derived bucket 的读写能力，
但不具有照片清理需要的删除及历史版本枚举能力；[bootstrap](../../infra/k8s/data-object-store/base/bootstrap.yaml)
在同一策略中补充限于 `dining/submissions/` 的 `DeleteObject`、`DeleteObjectVersion` 和带 prefix
条件的 `ListBucketVersions`，保留既有权限。不新增策略或身份；环境 owner 应用更新，已具备这些权限
的环境不必重复变更。`OBJECT_STORE_PRIVATE` 提供私有网络通道，S3 签名凭据提供对象操作授权，
两者不能互相替代。

App API 的 `local` 与 `staging` Wrangler 配置声明 `DINING_IMAGES` Images binding；本地使用模拟实现，
staging candidate 上传检查该 binding 及对象存储 Secret 是否随版本交付。

对象存储只在云端部署。本地模拟图片处理与存储测试不证明真实 Images 的完整解码、方向、透明、额度
或对象版本删除能力；这些能力仍须由环境 owner 按 [Dining PRD](../product/dining.md) 的样例完成云端
验收。投稿对象请求的客户端等待上限为 30 秒，上传预留 lease 为 5 分钟；客户端超时不证明
服务端已停止 PUT。环境验收须确认存储服务及入口的 PUT 执行上限短于上传 lease，
并覆盖连接中断后的迟到写入，才能确认未引用照片不会在清理后再次落盘。
提交 binding 与 Secret 消费配置不代表已经投递或验收通过。

## 产品与来源服务

| 类别 | 所有者 | 用途 |
| --- | --- | --- |
| 身份与安全验证 | App API、Campus Web | 账号、session、邮件验证和反滥用 |
| 邮件服务 | App API | 密码重置和账号通知 |
| 内部门户认证 | Ops Web、开发者程序、internal-portal-collection | Ops Web 在 `internal_portal` schema 管理多条 TGC、真实验证、检查和采集解析；采集任务不读取凭据表，本地通过 `pnpm --dir jobs/internal-portal-collection auth:pull` 写入当前 worktree，Job 入口只在内存中消费解析结果 |
| Cloudflare Worker 平台 | App API、Campus Web、status-web | Worker 运行、公开配置和平台绑定 |

来源凭据只进入所属采集器或任务，不进入在线问答、浏览器或通用仓库根环境。个人调试凭据不能
作为生产运行配置。

## 可观测性

产品请求和执行状态由 PostgreSQL、Temporal 与所属运行时日志提供；Agent trace 是可选的 Langfuse
运行能力。App API、Campus Web 和 Ops Web 不消费外部错误事件平台，也不维护供应商专用错误凭据。
Worker source map 由 Wrangler 在 Worker 发布链路中上传给 Cloudflare，用于平台侧 stack trace 映射；
它不改变产品状态，也不需要外部错误平台 token。

环境告警的查询、阈值、启用状态、notifier 和投递目标由环境仓及所属平台配置共同拥有，不进入
`packages/contracts`，也不由 Ops Web 提供在线编辑。不得把源码中的 `page`、`ticket` 等通用等级名
解释成 Campus Agent 团队或投递路由；`ticket` 不属于当前 Campus Agent 告警合同。当前通知事实只
以环境仓可执行的 monitor 与 notifier 配置为准。

字段与内容边界见 [运行时遥测](../reference/telemetry.md) 和 [Langfuse 运行合同](../contracts/langfuse-runtime.md)。

## 交付规则

- 本地 Secret 进入所属模块的忽略文件或开发者密钥管理器；`pnpm --dir jobs/internal-portal-collection auth:pull` 使用当前
  Kubernetes 权限读取既有 `OPS_WEB_INTERNAL_TOKEN`，通过临时 port-forward Ops Web
  取得 TGC，只写入内部门户采集任务受 `dev:init` 管理的 `.env.local`，不创建机器级缓存或 TGC
  Secret；linked worktree 显式执行 `dev:local credentials import` 时可从 main checkout 的同一受管文件首次导入已有 TGC，后续本地值
  优先；
- main checkout 根 `.env` 中白名单化的 provider 外部开发连接可由 `dev:local credentials import` 补充到 linked worktree；
  不复制整份环境文件、数据库连接、观测配置或 provider 配置加密 key；
- Kubernetes 非敏感启动值使用 ConfigMap，敏感材料使用 Secret 交付机制；
- Cloudflare 应用分别维护自己的 Worker vars 和 secrets；
- 跨平台共享认证值属于同一轮换单元，但由各平台独立投递，不能互相充当同步源；
- Secret 不进入 Git、镜像、前端包、日志或命令输出。Terraform 管理的资源若要求敏感输入，该值会
  保存在受保护的 state；当前仅 Hyperdrive origin password 属于这一合同，state 不充当 Secret 投递源；
- 环境仓选择部署版本和 Secret 引用；源码仓维护消费合同以及候选构建所需的代码和配置。
- Model Config 与内部 consumer 位于共同受信任边界，只通过 `MODEL_CONFIG_URL` 连接，不分发调用
  token、不登记 consumer，也不维护按 name 的权限矩阵。Provider API Key 由 Model Config 加密保存，
  只通过内部完整配置响应交给调用方，不返回浏览器。
- `OPS_WEB_AUTOMATION_ORIGIN` 是环境仓投递给 Ops Web 的非敏感机器端点配置；自动化 token 属于
  Ops Web PostgreSQL 数据，不进入 ConfigMap、GitOps Secret、内部门户采集任务或 URL。开发者程序
  只在请求时显式提供 `Authorization: Bearer <token>`。
- `OPS_WEB_INTERNAL_TOKEN` 继续是既有服务间认证值。`internal-portal-collection` Job 调用 Ops Web 时
  复用该值，不新增 `NOTICE_*`、TGC 或采集专用 token。通知采集和 notice-classifier 复用既有数据库
  owner Secret 与 PostgreSQL CA；notice-classifier 不读取对象存储，模型设置从 Model Config 读取。

环境文件和覆盖规则见 [环境文件](./env.md)，新增、轮换和撤销步骤见
[在线模型密钥操作](../runbooks/access/provider-secrets.md)。
