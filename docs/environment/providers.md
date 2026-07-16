---
doc_type: reference
owner_boundary: docs/environment
status: active
---

# Provider 与 Secret

## 边界

本文登记仓库支持的 provider family、所有者、secret 位置和常见任务的最小环境集合。console
操作和部署命令留在所属 runbook。

基本规则：

- `.env.example` 不是 staging/production secret inventory；
- 本地 seed 可以初始化 provider-config，active profile 仍由 app-api 所有；
- server secret 只进入 app-local dev vars、平台 secret store 或运维 env；
- browser 可见值必须明确标记为 public；
- ConfigMap、Secret、Helm value 和 Worker var/secret 只交付 bootstrap/secret，不能拥有模型或
  检索 active profile。

## 核心 Provider

### LLM

- 所有者：app-api provider-config；
- 消费方：agent-runtime、Hindsight 和 eval runtime；
- 当前 role：`primary_agent`、`hindsight_llm`；
- seed：`env/commands/provider-config-seed.env.example`；
- runtime：`CAMPUS_PROVIDER_CONFIG_SNAPSHOT_PATH`；
- raw key 不返回浏览器。

`primary_agent` 承担完整 Agents SDK run，包括 Knowledge Agent handoff；不存在独立 public-web
或第二个 answer-generation profile。

### 向量模型

- 所有者：app-api provider-config；
- 当前基线：`Qwen3-Embedding-4B`、2560 维、OpenAI-compatible；
- role：`rag_query_embedding`、`hindsight_embedding`、`eval_ragas_embedding`；
- runtime 真相：provider projection 与 collection serving config。

### Qdrant

- 所有者：ingestion/retrieval data plane；
- 在线 runtime 只使用 `QDRANT_QUERY_API_KEY`；
- admin key 只用于 lifecycle、backup、restore 或 ingestion；
- server key 和 TLS 由平台/data GitOps secret 提供；
- 跨 substrate endpoint 必须使用 HTTPS 和受控 CA；
- 不向在线执行 Pod 注入 admin key。

### Hindsight

- 所有者：personal memory runtime；
- execution-control 句柄：`PERSONAL_MEMORY_BASE_URL`、
  `PERSONAL_MEMORY_API_SECRET`、`PERSONAL_MEMORY_OWNER_SALT`；
- provider role：`hindsight_llm`、`hindsight_embedding`；
- Hindsight 内部 PostgreSQL、API secret 和 provider key 只属于部署 secret。

### PostgreSQL

root `.env` 只保存共享本地 `CAMPUS_SHARED_POSTGRES_URL` 和 operator URL。app、registry、
run projection 和 staging operator DSN 进入所属 runtime env。表所有权见
`../data/postgres-ownership.md`。

### 对象存储

架构语义统一为 S3-compatible object storage。bucket 路由和 source/derived 权限属于仓库合同，
provider 品牌不是。班车在线读取不经过对象存储。

## 食堂同步

`jobs/dining-sync` 负责从飞书 Base 写 catalog/review observation、发布 catalog/release、下载
已接受附件、写公开图片和 review projection。

配置类别：

- database：`DATABASE_URL` 或 operator DSN；
- 飞书应用：app ID/secret、base token、campus/hall/stall/dish/review table/view ID；
- 对象存储：endpoint、region、access key、secret、bucket、public base URL 和 review prefix；
- 内容审核：base URL、API key、文本/图片模型和 timeout。

这些值只进入 Job/CronJob，不进入 app-api Worker 或浏览器。生产使用项目专用飞书应用；个人
`lark-cli` 登录只用于调试。published projection 不得保存 file token 或临时下载 URL。

当前命令和 Secret 名见 `../runbooks/dining.md`，数据语义见 `../data/dining.md`。

## 应用与边缘 Provider

### Cloudflare Turnstile

- app-api secret：`AUTH_TURNSTILE_SECRET_KEY`；
- campus-web public 值：site key、appearance 和 execution；
- 保护 sign-in、sign-up 和 password reset；
- staging/production 使用允许目标 hostname 的 widget，自动化只使用官方测试 key。

### FeedWe

- 所有者：微信公众号来源采集；
- secret：`FEEDWE_EMAIL`、`FEEDWE_PASSWORD`、`FEEDWE_BASE_URL`；
- FeedWe 结果只用于发现/审计，canonical body/media 必须来自真实文章采集。

### Better Auth

- 所有者：app-api；
- 当前模式：email/password 与 reset；
- secret：`BETTER_AUTH_SECRET`；
- 当前不要求 GitHub、Google、WeChat 等 social OAuth credential。

### Resend

- 所有者：app-api；
- 用途：密码重置和密码变更邮件；
- secret/config：`RESEND_API_KEY`、发件地址和可选 reply-to。

### Cloudflare Worker

当前 Worker surface 为 app-api、campus-web 和 operator-console-web。每个应用使用自己的 Worker
secret store；数据面、对象存储和 execution runtime secret 不复制到 Worker。

Worker vars/secrets 不拥有 `primary_agent`、`rag_query_embedding` 或 `hindsight_*` active
profile。candidate upload 只产生不可变版本，流量由环境仓选择。

### Kubernetes 与 GitOps

源码仓保存 namespace-neutral base；环境仓保存 Argo CD Application、overlay、Helm value、
Secret delivery 和不可变版本选择。

- ConfigMap：非敏感启动配置；
- Secret、ExternalSecret、SealedSecret 或 SOPS：密钥材料；
- Helm value：第三方 chart 参数，不得包含供应商密钥、DSN、token 或应用配置决策。

### 遥测

Collector endpoint、认证和 sink credential 属于观测 runtime 与部署 secret store。事件和操作见
`../reference/telemetry.md`、`../runbooks/otel.md`。

## 常见环境最小集合

### 本地问答

- root `.env`：共享 PostgreSQL 句柄；
- provider seed 文件：仅创建/更新 profile 时；
- active `primary_agent`、`rag_query_embedding` profile；
- Qdrant 和 runtime secret projection；
- app-api `.env` / `.dev.vars`；
- campus-web `.dev.vars`；
- 使用 Operator Console 时再提供其 `.dev.vars`。

普通本地问答不要求 OCR、对象存储或独立 eval provider。

### 文档阅读器构建

增加 command-scoped reader build env 和 derived object-store 访问。每个 worktree 显式提供，
仓库不复制或软链接 ignored env。

### 采集

只增加目标 registry task 需要的 collector object-store、OCR/provider 和 serving config。
不得恢复旧 Python ingestion env 作为 fallback。

### 食堂 Job

增加飞书、PostgreSQL、公开图片对象存储和内容审核配置。app-api 在线请求只读 published
projection。

### Worker staging 候选版本

增加 Cloudflare upload 权限、应用 Worker secret、环境 Terraform 同步的 public config，以及
启用时的 Sentry/OTLP 配置。execution-control Kubernetes env 不复制到 Worker secret store。

## 当前不需要

- 社交 OAuth 凭据；
- 没有预算/配额隔离需求时的独立 eval provider；
- 没有声明 extraction lane 时的额外 OCR sidecar provider。
