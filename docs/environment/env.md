---
doc_type: reference
owner_boundary: docs/environment
status: active
---

# 环境文件

## 边界

本文定义本地和部署环境配置的分层规则。供应商与 Secret 所有权见
[Provider 与 Secret](./providers.md)，健康、就绪和环境交接的证据边界见
[测试与验证](../reference/verification.md)。精确变量由
所属应用模板、配置解析器和部署清单维护。

## 配置分层

### 仓库根环境

根 `.env` 只保存维护者共享的外部开发连接，不是应用运行时配置。linked worktree 的 target 包含 `core`、
`model-config`、`campus-docs-index-publisher`、`campus-rag-index-publisher` 或 `notice-index-publisher` 投影时，`dev:init` 才从 main
checkout 的根 `.env` 按字段白名单导入 LLM、Embedding、Rerank 和离线通知分类 provider 连接；包含
`internal-portal-collection` 投影时，才首次导入已有门户 TGC。它只补充
当前 worktree 尚不存在的字段，不覆盖已有值，也不复制数据库 DSN、对象存储身份、观测配置或整份环境文件。
应用仍不得直接读取根 `.env`；需要这些外部连接时，由调用 shell 或命令入口显式加载。

### 应用本地环境

应用只读取自身目录声明的环境文件。根目录的 `dev:init` 是唯一初始化入口；它根据 target 的实际消费者投影
及其声明的环境依赖，为当前 worktree 原子生成所需的 `0600` 文件。默认 target 是 `core`：

- App API：`.env.local` 和 `.dev.vars.local`；
- Campus Web：`.dev.vars.local`；
- Model Config：`.env.local`；
- execution-control：`.env.local`；
- agent-runtime：`.env.local`。

需要其他边界时显式选择 target：

- `pnpm dev:init -- --target ops-web`：Ops Web 及其本地通知采集、分类、发布任务；
- `pnpm dev:init -- --target notice-publisher`：notice-publisher；
- `pnpm dev:init -- --target internal-portal-collection`：internal-portal-collection adapter；
- `pnpm dev:init -- --target notice-classifier`：notice-classifier；
- `pnpm dev:init -- --target campus-docs-index-publisher`：Campus Docs Chunk/Embedding 与 Docs-only local 验证任务；
- `pnpm dev:init -- --target campus-rag-index-publisher`：统一 Campus RAG publisher 本地连接环境；
- `pnpm dev:init -- --target notice-index-publisher`：已发布通知 Chunk 本地任务。

target 会自动生成其运行依赖的环境投影；例如 `internal-portal-collection` 生成 Ops Web 和采集器所需的
文件，`notice-classifier` 只生成 Model Config 与分类器所需的文件。schema、seed 和 Temporal namespace
由各自 owner 的 readiness probe 判断，只有缺失的步骤才执行；不存在第二份 lifecycle journal。

`notice-publisher` target 通过 `campus-agent-schema` 安装统一 baseline 并写入通知分类；`ops-web` target
还生成通知采集、分类和发布任务环境，写入 `notice_classification` Model Config 与 Dining 基线。
`internal-portal-collection` 和 `notice-classifier` 不重复执行 DDL。`notice-index-publisher` target 通过
同一 schema owner 补齐数据库 baseline；`campus-docs-index-publisher` 只生成任务环境，不执行应用 bootstrap。

这些文件带有管理标记，不提交 Git，也不供人工编辑；命令拒绝覆盖同路径的开发者自有文件。重新初始化保留已生成的本地应用 secret，并按当前 profile 重写端口、数据库和 bucket 地址。核心应用的 worktree 连接、端口和本地 secret 由托管文件提供；Hindsight、OTEL、代理等不属于托管文件的外部配置仍由 shell、`op run` 或其他可选 secret manager 注入，不写入 profile 或机器注册表。

包含 `core` 或 `model-config` 投影的 target 还会为当前 worktree 创建 `0600` 的
`var/dev/model-config-encryption.key`，供 Model Config 当前密文使用；密钥不进入 profile、其他 worktree
或部署环境。

托管本地环境不连接 Turnstile：Campus Web 不渲染验证码，App API 只对本地禁用标记跳过
CAPTCHA 插件。部署环境是否启用 Turnstile 及其配置由该环境实际选择决定。

### Git hook

Git hook 不属于应用环境文件。当前 checkout 或 linked worktree 执行 `pnpm install` 时，`prepare`
生命周期会调用标准 `prek install`，设置 worktree-local `core.hooksPath=.githooks`，并安装配置中声明的
hooks；不会引用其他 checkout 的 Node 或 Python 环境。生成的 `.githooks/` 被 Git 忽略。使用
`pnpm install --ignore-scripts` 时不会自动安装 hook；依赖已安装但 hook 缺失时重新执行
`pnpm hooks:install`。

`uv sync --locked --all-packages --dev` 提供 Ruff、SQLFluff 和 Yamllint，`pnpm dev:init` 仍只负责应用
环境初始化，不参与 Git hook 安装。CI、production install 和 Docker/包构建不会触发 Git hook 安装，
因此只需要复制构建所需的 workspace 文件。

internal-portal-collection 的托管 `.env.local` 保存当前 worktree 的 source bucket、通知数据库和 Ops Web
内部接口配置，以及 `pnpm --dir jobs/internal-portal-collection auth:pull` 最近一次成功解析的 `INTERNAL_PORTAL_SSO_TGC`。拉取命令
保留其他托管字段、原子替换该值并设置 `0600`；失败不改文件，后续 `dev:init` 保留已有 TGC。可选门户
代理由进程环境显式提供，且进程环境具有最高优先级。linked worktree 首次初始化时，如果 main checkout
当前采集目录的托管 `.env.local` 已有 TGC，则将它导入该文件；之后 worktree 自己通过 `auth:pull` 更新的值
优先，不被再次初始化覆盖。

notice-classifier 的托管 `.env.local` 保存本 worktree 的通知数据库连接和非敏感 `MODEL_CONFIG_URL`，
不再包含对象存储配置。它不保存模型 API key、模型名或 provider 配置；本地 Job 启动分类阶段时从
Model Config 一次读取当前完整配置。

Campus Docs builder 的托管 `.env.local` 保存对象存储 endpoint 和 derived bucket 写入凭据；derived bucket
使用当前 profile 的 `OBJECT_STORE_BUCKET_DERIVED`。Campus Web 与其他应用共用当前 profile 的 `OBJECT_STORE_*` 配置。统一 Campus RAG publisher 的托管 `.env.local` 保存
`EXECUTION_CONTROL_DATABASE_URL`、Qdrant endpoint/API key、对象存储 endpoint、当前 worktree 的
`OBJECT_STORE_BUCKET_DERIVED` 和该 bucket 的读写凭据；写入凭据用于本地制品导入。Qdrant 连接由
`scripts/dev` 在初始化时读取正在运行的本地 Compose 容器的 writer key 和 HTTP 映射端口，经认证检查后
写入现有托管文件；每次初始化重新读取，不维护第二份凭据状态。Qdrant 服务配置仍由
`infra/local/docker-compose.qdrant.yml` 拥有；若本地服务供应方式改变，应同步调整此连接读取逻辑。
publisher 不读取 Model Config、Notices 数据库或 embedding provider。Notice index publisher 的托管 `.env.local` 保存
`DEPLOYMENT_ENVIRONMENT`、`NOTICES_DATABASE_SSLMODE`、
`NOTICES_DATABASE_URL`。Notice 问题生成只从当前 worktree 根 `.env` 显式读取 LLM 配置；两个任务的本地
embedding evaluation 和 Notice embedding 抽样验证都从当前 worktree 根 `.env` 显式读取 `EMBEDDING_BASE_URL` 与
`EMBEDDING_API_KEY`，不读取其他 job 的环境文件；Campus Docs 的本地 embedding
构建也使用同一根 `.env`，线上 Campus Docs Embedding Job 仍从 Model Config 获取完整 runtime config。

Ops Web 的托管 `.env.local` 保存本 worktree 的数据库连接和本地 derived bucket 连接；本地 Job 继续读取
各自所有者的托管环境文件，而不是把任务凭据复制进 Ops Web。notice-publisher 的
托管 `.env.local` 保存本地 `notice_publisher` 数据库连接、明确禁用 TLS
的本地标记，以及分离的 source/derived 对象存储身份；门户 hostname 直接读取仓库 source descriptor，
不再维护重复环境变量。App API 的托管变量提供本地 derived bucket 地址、通知图片读取所需的只读凭据
及投稿照片读写清理所需的 derived 写凭据；地址配置不代表已启动本地对象存储。部署环境通过现有
私有对象存储 binding 发送签名请求，仍需相应 S3 凭据；交付边界见
[对象存储配置](./providers.md#对象存储)。应用之间不读取彼此环境文件。
一个应用不得读取其他应用或适配器的环境文件，也不得从根 `.env` 隐式扩散数据库或供应商凭据。

### 命令环境

需要显式运行配置的仓库命令使用 `env/commands/*.env.example`。命令模板只保存变量名和安全示例，
不保存真实值，也不成为常驻应用的配置来源。

本地任务标识、来源引用和其他单次输入通过类型化请求或 CLI 参数传递。Kubernetes 一次性 Job 可以在
从固定 CronJob 模板创建时，通过 `kubectl set env --local` 写入该 Job 独有的数据选择；这些值不进入
CronJob、ConfigMap、Secret 或长期环境配置。

### 部署环境

Kubernetes、Cloudflare 和外部平台配置由环境仓及所属密钥存储交付。ConfigMap、Secret、平台变量
和在线模型配置各自服务明确消费者，不能互相充当同步源。

长期运行的 Kubernetes workload 从共享 ConfigMap 逐 key 投影实际消费字段。只服务单个一次性 Job
且字段全部由该 Job 消费的专用 ConfigMap 可以整体注入。

内部门户采集、notice-classifier 和 notice-publisher 只读取各自 workload 声明的数据库、对象存储、
Ops Web 或 Model Config 配置。任务参数属于单次 Job 输入，不进入长期环境配置；模板和任务操作由
[采集与发布手册](../runbooks/ingestion.md)维护。

### 部署配置生命周期

部署变量从实际消费者开始定义。应用配置解析器、Wrangler 配置、GitHub Actions workflow 或
Kubernetes workload 必须先存在明确读取点，环境仓才能投递对应值；GitHub settings 不能作为
待用配置或历史档案。

- repository scope 只保存不随部署环境变化的仓库自动化配置；环境地址、资源标识和凭据使用实际
  消费它们的 GitHub Environment；
- GitHub Environment 提供环境值和凭据作用域，不等于每个引用它的 job 都在部署。候选制品发布、
  校验、等待和凭据同步 job 使用 `deployment: false`；只有实际交付 job 创建 Deployment 记录；
- variable 和 secret 只使用消费者所需的最简语义名称，不再添加 `STAGING_`、`DEV_`、`DEVELOPMENT_`、
  `PROD_` 或 `PRODUCTION_` 前缀；
- 环境派生的非敏感值由环境仓 Terraform 投递，不能同时人工维护；Secret 由所属密钥存储投递。
  Cloudflare provider 当前要求 Hyperdrive origin password 作为 resource 输入，因此该值会进入受保护的
  Terraform state；不能据此把 state 当作 Secret 投递源；
- 一个变量只有一个消费合同和一个交付所有者。跨平台必须共享的认证值按同一轮换单元分别投递，
  不建立同步源或别名；
- 重命名直接切换消费合同并删除旧名称，不保留双读、fallback 或兼容变量；
- 删除最后一个消费者时，同一治理任务必须删除配置解析、workflow 或 manifest 引用、环境仓投递
  声明、远端 GitHub variable/secret、示例、测试和说明；
- 完成变量变更前，应使用 GitHub CLI 只读列举 Source 与环境仓的 repository、Environment variable
  和 secret 名称，并与当前可执行消费者及 Terraform 投影核对。远端值不进入输出。

仓库不维护手写的全局变量表。变量名和必需性以所属消费者为准，环境仓只维护当前环境实际投递的
集合，远端核对只用于确认配置生命周期已经闭合。

Campus Web 的文档准备入口按以下顺序合并配置，后者覆盖前者：

1. 当前应用的 `.dev.vars.local`；
2. `env/commands/campus-docs-source.env`；
3. 调用进程环境。

命令配置只用于显式切换文档来源；普通本地构建直接使用 `dev:init` 生成的应用配置，不需要手工
`source`。对象存储地址和派生桶凭据只服务本地或受信任的来源准备与正式构建，不投递到
PR、Worker、Wrangler 或 Argo，也不会传入 Vite。`CAMPUS_WEB_BUILD_TARGET` 与
`CAMPUS_WEB_DOCS_CONTENT_ROOT` 由构建脚本临时生成，同样不进入环境配置。`build:fixture` 使用固定测试
输入，不读取以上对象存储配置。

## 读取与覆盖

本地开发统一使用“进程环境、应用 `.env.local`/`.dev.vars.local`、应用基础文件”的优先级。部署和一次性命令仍由各自解析器、Wrangler 配置或命令入口声明读取顺序。

稳定业务事实进入配置、注册表、manifest 或数据库投影。只有会随环境变化的资源地址、凭据和
运行参数才进入环境文件。

## Worktree

Git 不会把被忽略的环境文件带入新 worktree。每个 worktree 首次显式运行 `pnpm dev:init` 时获得独立
profile、按 target 选择的应用文件、端口、数据库和所需的实例资源；linked worktree 同时按上述白名单从
main checkout 补充维护者共享的 provider 连接和已有门户 TGC。PostgreSQL、RustFS、Qdrant 与 Temporal 容器、网络和数据卷按 worktree 独立，由当前 worktree 的 `dev:init` 启动和检查。真实检索数据由
当前 worktree 的 `pnpm dev:init -- --target core --data cluster --context <context> --namespace <namespace>` 同步；
每个 worktree 可显式请求集群只读 Secret，并只写自己的 Qdrant 和 current index。

每个 worktree 都由自己的 profile 供应并探测本地依赖。execution-control 与 agent-runtime 从当前 worktree 源码独立启动，不共享
其他 worktree 的宿主进程。应用统一消费当前 profile 的 `OBJECT_STORE_*`；`RUSTFS_*` 只存在于供应商容器边界，不进入
应用环境合同。Campus Web 文档使用当前 profile 的 derived bucket；缺少
`campus-docs/source.json` 时由 Campus Web docs owner 写入确定性样例，不覆盖已有来源。

Execution Control 通过 `EXECUTION_CONTROL_DATABASE_URL` 读取当前 profile 的
`campus_docs_serving.current_index`；该连接使用独立的本地只读角色，运行记录仍使用当前 worktree 的
`EXECUTION_CONTROL_DATABASE_URL`。

profile 位于当前 worktree 的 `var/dev/profile.json`，机器级实例注册表位于
`${XDG_STATE_HOME:-~/.local/state}/campus-agent/<repo-key>/instances.json`。只支持 schema v3；旧的 v1/v2 profile 或 registry 会 fail-closed，必须人工删除旧文件和旧资源后重新初始化，不会自动转换、迁移或写回；profile 只保存资源身份，
不保存外部凭据。使用 `pnpm dev:instances` 查看 metadata-only 清单，使用
`pnpm dev:instances -- --verify` 才探测真实资源；`pnpm dev:doctor` 检查当前 target 的配置完整性。
`pnpm dev` 只读取 ready 状态，不执行初始化、迁移或 seed。当前 profile 依赖不可探测时结果为 `unknown`，不会据此
自动创建或删除实例资源。

stale 实例不会自动清理。先运行 `pnpm dev:prune` 列出 stale 记录，再明确指定单个实例和确认值执行清理；
该命令不会批量删除资源。销毁时各实例资源独立探测；某项依赖暂时不可用时，已确认的其他资源可以清理，
但实例注册会保留，待依赖恢复后重试。

`pnpm dev:destroy` 默认只打印影响范围。只有同时提供同一个实例 ID 才会删除该实例的 database、按需创建的
derived bucket、Temporal namespace、托管环境文件和注册记录；它不会启动或重建其他 worktree 的容器，也不会删除其他实例
source/docs bucket、网络或数据卷：

    pnpm dev:destroy -- --instance <instance-id> --confirm <instance-id>

## 相关文档

- [Provider 与 Secret](./providers.md)
- [测试与验证](../reference/verification.md)
- [供应商密钥操作](../runbooks/provider-secrets.md)
- [采集与发布手册](../runbooks/ingestion.md)
- [Secret 投递决策](../../.agents/notes/implemented/process/2026-07-04-secret-delivery.md)
