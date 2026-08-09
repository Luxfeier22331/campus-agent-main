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
| 查询 Embedding | execution-control 当前模型设置 | 检索运行时 | 固定 Qwen3/2560，与索引发布配置相容，查询凭据不具备索引管理权限 |
| 个人记忆 LLM、Embedding、RRF | 环境仓的 Hindsight Helm 配置 | Hindsight | 不从 execution 配置、Ops Web 或评测配置派生 |
| 评测模型 | 评测命令运行环境 | Ragas 适配器 | 不复用在线配置数据库或浏览器凭据 |

具体模型、维度、transport 和 endpoint 由当前模型设置、collection serving config 与
可执行注册表维护，不在本文复制。

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
| 内部门户认证 | Ops Web、Source Collector | Ops Web 在所属 PostgreSQL 管理多条 TGC；Source Collector 只消费开发者显式提供的本地 TGC，不读取部署 Secret |
| Cloudflare Worker 平台 | App API、Campus Web | Worker 运行、公开配置和平台绑定 |

来源凭据只进入所属采集器或任务，不进入在线问答、浏览器或通用仓库根环境。个人调试凭据不能
作为生产运行配置。

## 可观测性

外部平台管理与运行时消费保持现有逻辑 token 合同，不因删除消费者新增或机械拆分凭据。Axiom
当前运行时消费者只有 Worker application-log destination 和 Ops Web logs query；Terraform 继续
使用既有管理合同。Sentry 也沿用既有 provider token，投影到 Terraform、Source staging
Environment 和 Ops Web runtime Secret。不同环境位置的变量名只是消费方投影，不代表必须创建
新的上游身份或轮换单元。完整理由见 ADR-0081。

`AXIOM_RUNTIME_TOKEN` 是现有 `observability-runtime-secrets` 字段，本次不新增或拆分；Sentry
继续使用现有 `SENTRY_AUTH_TOKEN`，不创建 `SENTRY_RUNTIME_AUTH_TOKEN`。

- app-api producer 在 Cloudflare log destination 前执行字段白名单，不依赖 Collector 清理；
- Ops Web 只执行固定范围的 Axiom logs 查询和 Sentry Issue 读取；
- Worker 日志目标和 source map 上传凭据只进入所属平台配置或受保护 CI 环境；
- Langfuse Agent trace、Axiom application logs 和 Sentry 错误事件保持不同数据边界。

环境告警的查询、阈值、启用状态、notifier 和投递目标由环境仓及所属平台配置共同拥有，不进入
`packages/contracts`，也不由 Ops Web 提供在线编辑。不得把源码中的 `page`、`ticket` 等通用等级名
解释成 Campus Agent 团队或投递路由；`ticket` 不属于当前 Campus Agent 告警合同。当前通知事实只
以环境仓可执行的 monitor 与 notifier 配置为准。

字段与内容边界见 `../reference/telemetry.md`、`../architecture/system/langfuse.md` 和
`../architecture/system/ops-observability.md`。

## 交付规则

- 本地 Secret 进入应用自己的忽略文件或开发者密钥管理器；开发者从 Ops Web 按需取出的内部门户
  TGC 只写入 Source Collector 适配器未跟踪的 `.env`，不进入 `dev:init` 管理的 `.env.local`；
- Kubernetes 非敏感启动值使用 ConfigMap，敏感材料使用 Secret 交付机制；
- Cloudflare 应用分别维护自己的 Worker vars 和 secrets；
- 跨平台共享认证值属于同一轮换单元，但由各平台独立投递，不能互相充当同步源；
- Secret 不进入 Git、镜像、前端包、日志或命令输出。Terraform 管理的资源若要求敏感输入，该值会
  保存在受保护的 state；当前仅 Hyperdrive origin password 属于这一合同，state 不充当 Secret 投递源；
- 环境仓选择部署版本和 Secret 引用，源码仓只维护环境无关的消费合同。

环境文件和覆盖规则见 `env.md`，新增、轮换和撤销步骤见
`../runbooks/provider-secrets.md`。
