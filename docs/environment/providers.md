---
doc_type: reference
owner_boundary: docs/environment
status: active
---

# Provider 与 Secret

## 文档边界

本文登记供应商类别、消费方、配置所有者和凭据隔离原则。精确环境变量由应用模板和配置解析器
维护，在线当前值由运行配置维护，部署 Secret 名和地址由 workload manifest 与环境仓
维护。

`.env.example` 不是 staging 或 production 的 Secret 清单，ConfigMap、Secret 和平台变量也不
替代在线模型配置、Hindsight 内部配置或评测运行配置。

## 模型与检索

| 能力 | 配置所有者 | 消费方 | 隔离要求 |
| --- | --- | --- | --- |
| LLM | execution-control 当前模型设置 | agent-runtime | Activity 调用读取当前值，不向浏览器返回密钥 |
| Embedding 连接 | execution-control 当前模型设置 | Campus Docs Embedding Job、在线检索 Activity | Ops Web 只替换 Base URL 和 API key；provider、model、transport 与 2560 维向量空间由 Campus Docs 固定合同拥有 |
| 通知分类连接 | execution-control 当前模型设置 | notice-classifier 在线 Job | Job 启动阶段读取一次内部快照；不接收独立模型 Secret，API key 不返回浏览器 |
| 个人记忆 LLM、Embedding、RRF | 环境仓的 Hindsight Helm 配置 | Hindsight | 不从 execution 配置、Ops Web 或评测配置派生 |
| 评测模型 | 评测命令运行环境 | Ragas 适配器 | 不复用在线配置数据库或浏览器凭据 |

Embedding Job 在启动后读取一次当前连接并直接调用 provider；在线检索按准入时冻结的同一设置 hash
解析连接。系统不为索引构建维护第二份连接配置。Embedding provider 固定为 `openai-compatible`，
model 固定为 `Qwen3-Embedding-4B`，transport 固定为 `embeddings`，dimensions 固定为 `2560`；
`embedding_space_id`、查询指令和向量名来自 v2 制品及 `campus_docs_serving.current_index`，并在运行
准入时核对和冻结。

具体模型、transport 和 endpoint 由当前模型设置、索引制品与可执行注册表维护，不在本文复制。

通知分类 Job 在启动分类阶段后读取一次 `notice_classifier_provider_snapshot.v1`，直接调用快照中的
transport。模型名、provider、Base URL 和 API key 由 Ops Web 的独立通知分类模型设置维护；本地
`pnpm notice:classify:job:local` 通过端口转发读取同一份 execution-control 快照，不保存模型连接。
保留的 `pnpm notice:classify` JSONL/评测命令可以由调用进程显式提供连接，用于离线模型比较，不是在线
Job 的配置来源。

## 数据服务

### PostgreSQL

应用、发布任务、配置管理和运维读取使用各自角色。连接拓扑与角色边界见
`../data/postgres-ownership.md`，不得为了减少 Secret 数量合并成共享高权限账号。

### Qdrant

在线查询凭据与索引生命周期管理凭据分离。在线执行只获得查询所需权限，采集、发布、备份和
恢复使用独立管理边界。

### 对象存储

来源和派生产物使用 S3-compatible 接口及按 bucket、prefix 和操作范围限制的凭据。应用只获得
直接消费对象所需权限；对象存储品牌不进入数据合同。Kubernetes 内的写入者使用各自 S3 凭据；
当前 App API 的 Dining 资源接口通过 Workers VPC binding 访问明确前缀，不获得 S3 凭据。

对象存储管理身份在 Secret 中使用 `OBJECT_STORE_ADMIN_ACCESS_KEY` 和
`OBJECT_STORE_ADMIN_SECRET_KEY`。部署清单只在 RustFS 容器边界把它们映射为
`RUSTFS_ACCESS_KEY` 和 `RUSTFS_SECRET_KEY`；应用身份继续使用 source/derived 各自的
`OBJECT_STORE_*` 键。供应商名称不进入 Secret 的稳定键名。

## 产品与来源服务

| 类别 | 所有者 | 用途 |
| --- | --- | --- |
| 身份与安全验证 | App API、Campus Web | 账号、session、邮件验证和反滥用 |
| 邮件服务 | App API | 密码重置和账号通知 |
| 微信公众号来源 | Source Collector | 发现来源并取得采集入口，规范正文仍来自真实文章 |
| 内部门户认证 | ingestion-control、Ops Web、开发者程序、Source Collector | ingestion-control 在所属 PostgreSQL 管理多条 TGC 并提供采集解析；Ops Web 保存 automation token 并代理人员/机器管理请求；Source Collector 不读数据库，本地通过 `auth:pull` 写入当前 worktree，Job 入口只在内存中消费解析结果 |
| Cloudflare Worker 平台 | App API、Campus Web、status-web | Worker 运行、公开配置和平台绑定 |

来源凭据只进入所属采集器或任务，不进入在线问答、浏览器或通用仓库根环境。个人调试凭据不能
作为生产运行配置。

## 可观测性

外部平台管理与运行时消费使用不同权限边界。Axiom 的 Worker application-log destination 和 Ops Web
logs query 使用运行时 token，Terraform 使用平台管理身份。Sentry 的 source map 上传和 Ops Web Issue
查询使用所属环境投递的 provider token。不同环境位置的变量名只是消费方投影，不代表独立的上游
身份或轮换单元。完整理由见 ADR-0081。

`AXIOM_RUNTIME_TOKEN` 是 `observability-runtime-secrets` 的运行时字段；Sentry 使用
`SENTRY_AUTH_TOKEN`。仓库没有 `SENTRY_RUNTIME_AUTH_TOKEN` 消费合同。

- app-api producer 在 Cloudflare log destination 前执行字段白名单，不依赖 Collector 清理；
- Ops Web 只执行固定范围的 Axiom logs 查询和 Sentry Issue 读取；
- Worker 日志目标和 source map 上传凭据只进入所属平台配置或受保护 CI 环境；
- Langfuse Agent trace、Axiom application logs 和 Sentry 错误事件保持不同数据边界。

环境告警的查询、阈值、启用状态、notifier 和投递目标由环境仓及所属平台配置共同拥有，不进入
`packages/contracts`，也不由 Ops Web 提供在线编辑。不得把源码中的 `page`、`ticket` 等通用等级名
解释成 Campus Agent 团队或投递路由；`ticket` 不属于当前 Campus Agent 告警合同。当前通知事实只
以环境仓可执行的 monitor 与 notifier 配置为准。

字段与内容边界见 `../reference/telemetry.md` 和 `../contracts/langfuse-runtime.md`。

## 交付规则

- 本地 Secret 进入应用自己的忽略文件或开发者密钥管理器；`auth:pull` 使用当前 Kubernetes 权限读取
  既有 `OPS_WEB_INTERNAL_TOKEN`，通过临时 port-forward ingestion-control 取得 TGC，只写入 Source Collector 适配器
  受 `dev:init` 管理的 `.env.local`，不创建机器级缓存或 TGC Secret；
- Kubernetes 非敏感启动值使用 ConfigMap，敏感材料使用 Secret 交付机制；
- Cloudflare 应用分别维护自己的 Worker vars 和 secrets；
- 跨平台共享认证值属于同一轮换单元，但由各平台独立投递，不能互相充当同步源；
- Secret 不进入 Git、镜像、前端包、日志或命令输出。Terraform 管理的资源若要求敏感输入，该值会
  保存在受保护的 state；当前仅 Hyperdrive origin password 属于这一合同，state 不充当 Secret 投递源；
- 环境仓选择部署版本和 Secret 引用，源码仓只维护环境无关的消费合同。
- `OPS_WEB_AUTOMATION_ORIGIN` 是环境仓投递给 Ops Web 的非敏感机器端点配置；自动化 token 属于
  Ops Web PostgreSQL 数据，不进入 ConfigMap、GitOps Secret、Source Collector 或 URL。开发者程序
  只在请求时显式提供 `Authorization: Bearer <token>`。
- `OPS_WEB_INTERNAL_TOKEN` 继续是既有服务间认证值。Ops Web BFF 和 Source Collector Job 调用
  ingestion-control 时复用该值，不新增
  `NOTICE_*`、TGC 或 Source Collector 专用 token；notice-classifier 只复用已有对象存储 Secret，模型
  设置通过 execution-control 快照提供。

环境文件和覆盖规则见 `env.md`，新增、轮换和撤销步骤见
`../runbooks/provider-secrets.md`。
