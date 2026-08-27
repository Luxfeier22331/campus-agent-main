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

根 `.env` 只保存维护者共享的外部开发连接，不是应用运行时配置。linked worktree 执行 `dev:init` 时，
从 main checkout 的根 `.env` 按字段白名单导入 LLM、Embedding、Rerank 和离线通知分类 provider 连接；
只补充当前 worktree 尚不存在的字段，不覆盖已有值，也不复制数据库 DSN、对象存储身份、观测配置或
整份环境文件。应用仍不得直接读取根 `.env`；需要这些外部连接时，由调用 shell 或命令入口显式加载。

### 应用本地环境

应用只读取自身目录声明的环境文件。显式执行 `pnpm dev:init` 为当前 worktree 原子生成核心应用的以下
`0600` 文件：

- App API：`.env.local` 和 `.dev.vars.local`；
- Campus Web：`.dev.vars.local`；
- Model Config：`.env.local`；
- execution-control：`.env.local`；
- agent-runtime：`.env.local`。

可选应用按需执行自己的初始化命令生成文件：

- `pnpm --filter ops-web dev:init`：Ops Web；
- `pnpm --filter notice-publisher dev:init`：notice-publisher；
- `pnpm --filter internal-portal-collection dev:init`：internal-portal-collection adapter；
- `pnpm --filter notice-classifier dev:init`：notice-classifier。

`notice-publisher dev:init` 先通过 `campus-agent-schema` 安装统一 baseline，再写入本地通知分类 seed。
新的本地 profile 在运行 internal-portal-collection 通知模式或 notice-classifier 前先执行该命令；
后两者的 `dev:init` 只生成各自环境文件，不执行 DDL。

`ops-web dev:init` 使用同一个 `campus-agent-schema` 入口安装全部 schema 和授权，再写入通知分类与
Dining 本地 seed，使运行记录与通知页面可以在新的本地 profile 中直接启动。

这些文件带有管理标记，不提交 Git，也不供人工编辑；命令拒绝覆盖同路径的开发者自有文件。重新初始化保留已生成的本地应用 secret，并按当前 profile 重写端口、数据库和 bucket 地址。核心应用的 worktree 连接、端口和本地 secret 由托管文件提供；Hindsight、OTEL、代理等不属于托管文件的外部配置仍由 shell、`op run` 或其他可选 secret manager 注入，不写入 profile 或机器注册表。

`dev:init` 还为当前 worktree 创建 `0600` 的 `var/dev/model-config-encryption.key`，供 Model Config
当前密文使用。`var/dev/provider-config-encryption.key` 只属于保留的历史切换 runner，标准本地
bootstrap 不再隐式生成；显式验证旧切换路径时由调用者单独准备。密钥不进入 profile、其他 worktree
或部署环境。

托管本地环境不连接 Turnstile：Campus Web 不渲染验证码，App API 只对本地禁用标记跳过
CAPTCHA 插件。部署环境是否启用 Turnstile 及其配置由该环境实际选择决定。

internal-portal-collection 的托管 `.env.local` 保存当前 worktree 的 source bucket、通知数据库和 Ops Web
内部接口配置，以及 `internal-portal:auth:pull` 最近一次成功解析的 `INTERNAL_PORTAL_SSO_TGC`。拉取命令
保留其他托管字段、原子替换该值并设置 `0600`；失败不改文件，后续 `dev:init` 保留已有 TGC。adapter
目录下未跟踪的 `.env` 只维护可选门户代理或不使用托管本地环境的对象存储配置，不作为长期 TGC 来源。
进程环境仍具有最高优先级。linked worktree 首次初始化时，如果 main checkout 当前或已退役采集目录的
托管 `.env.local` 已有 TGC，则将它导入该文件；之后 worktree 自己通过 `auth:pull` 更新的值优先，不被
再次初始化覆盖。

notice-classifier 的托管 `.env.local` 保存本 worktree 的通知数据库连接和非敏感 `MODEL_CONFIG_URL`，
不再包含对象存储配置。它不保存模型 API key、模型名或 provider 配置；本地 Job 启动分类阶段时从
Model Config 一次读取当前完整配置。

Ops Web 的托管 `.env.local` 保存本 worktree 的数据库连接和本地 source bucket 连接。notice-publisher 的
托管 `.env.local` 保存本地 `notice_publisher` 数据库连接、明确禁用 TLS
的本地标记，以及分离的 source/derived 对象存储身份；门户 hostname 直接读取仓库 source descriptor，
不再维护重复环境变量。App API 的托管变量提供本地 derived bucket 地址和只读凭据，用于通知图片与
其他获准的派生资源；部署环境改用现有私有对象存储 binding。应用之间不读取彼此环境文件。

App API 的托管变量提供本地 derived bucket 地址和只读凭据，用于通知图片与其他获准的派生资源；部署
环境改用现有私有对象存储 binding。应用之间不读取彼此环境文件。

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

内部门户采集使用三个默认暂停的 CronJob 模板，分别固定执行通知增量、通知回填和文件发布采集。
通知维护状态是 `[covered_from, covered_until)` 半开区间；sync 和 backfill 是两个独立 Job，回填日期只在
创建该次 Job 时写入，首次初始化使用 `2025-12-01`。模板读取 `OPS_WEB_INTERNAL_URL`、
`OPS_WEB_INTERNAL_TOKEN` 和 source bucket 配置；通知增量与回填还读取既有数据库 owner 连接并登记
通知库存。模板默认暂停，只用于显式创建一次性 Job；不得新增 TGC Secret。

notice-classifier 读取既有数据库 owner 连接和 Model Config，不读取 source/derived bucket，也不创建
分类器专用数据库身份或模型 Secret。

notice-publisher 的 schema Job 和默认暂停的发布模板复用既有 `campus_agent` owner Secret、PostgreSQL
CA 与 source/derived 对象存储 Secret。部署环境不创建 `notice_publisher` 角色、专用密码或自动 schedule；
选择通知 ID 时只修改该次 Job 的容器参数，不修改 CronJob 或长期配置。

### 部署配置生命周期

部署变量从实际消费者开始定义。应用配置解析器、Wrangler 配置、GitHub Actions workflow 或
Kubernetes workload 必须先存在明确读取点，环境仓才能投递对应值；GitHub settings 不能作为
待用配置或历史档案。

- repository scope 只保存不随部署环境变化的仓库自动化配置；环境地址、资源标识和凭据使用实际
  消费它们的 GitHub Environment；
- GitHub Environment 已经选择部署环境，variable 和 secret 只使用消费者所需的最简语义名称，不再
  添加 `STAGING_`、`DEV_`、`DEVELOPMENT_`、`PROD_` 或 `PRODUCTION_` 前缀；
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

Campus Web 的 `dev`、`build` 和 `build:staging` 在文档准备阶段按以下顺序合并配置，
后者覆盖前者：

1. 当前应用的 `.dev.vars.local`；
2. `env/commands/campus-docs-source.env`；
3. 调用进程环境。

命令配置只用于显式切换文档来源；普通本地构建直接使用 `dev:init` 生成的应用配置，不需要手工
`source`。对象存储地址和派生桶凭据只服务本地或受信任的来源准备、正式构建和来源更新，不投递到
PR、Worker、Wrangler 或 Argo，也不会传入 Vite。`CAMPUS_WEB_BUILD_TARGET` 与
`CAMPUS_WEB_DOCS_CONTENT_ROOT` 由构建脚本临时生成，同样不进入环境配置。`build:test` 使用固定测试
输入，不读取以上对象存储配置。

`docs:source:update` 不调用上述构建环境加载器，只读取调用进程环境。需要复用
`env/commands/campus-docs-source.env` 时，操作者必须先在当前 shell 中显式加载该文件。

## 读取与覆盖

本地开发统一使用“进程环境、应用 `.env.local`/`.dev.vars.local`、应用基础文件”的优先级。部署和一次性命令仍由各自解析器、Wrangler 配置或命令入口声明读取顺序。

稳定业务事实进入配置、注册表、manifest 或数据库投影。只有会随环境变化的资源地址、凭据和
运行参数才进入环境文件。

## Worktree

Git 不会把被忽略的环境文件带入新 worktree。每个 worktree 首次显式运行 `pnpm dev:init` 时获得独立
profile、核心应用文件、端口、PostgreSQL database、derived bucket、Temporal namespace 和 provider
配置加密密钥；同时按上述白名单从 main checkout 补充维护者共享的外部开发凭据。PostgreSQL、RustFS 与
Temporal 容器、网络和数据卷由同一机器上的 worktree 共享。主 checkout 是共享依赖的
bootstrap/reconcile owner，linked worktree 不会重新执行 Compose reconcile，只在共享依赖 ready 时
复用。execution-control 与 agent-runtime 从当前 worktree 源码独立启动，不共享其他 worktree 的宿主
进程。应用仍只消费
`OBJECT_STORE_*`；`RUSTFS_*` 只存在于供应商容器边界，不进入应用环境合同。
Campus Web 文档合同固定使用共享 `campus-agent-derived`；`dev:init` 只在
`campus-docs/source.json` 缺失时写入确定性开发样例，不覆盖已有文档来源。worktree profile 中的
独立 derived bucket 仍只服务 Dining 等实例数据。

profile 位于当前 worktree 的 `var/dev/profile.v1.json`，机器级实例注册表位于
`${XDG_STATE_HOME:-~/.local/state}/campus-agent/<repo-key>/instances.v1.json`。两者只保存资源身份，不保存
外部凭据；导入值只进入当前 worktree 被忽略的所属环境文件。使用 `pnpm dev:instances` 查看分配和
stale/partial 状态，使用 `pnpm dev:doctor` 检查完整性。`pnpm dev` 只读取这份就绪状态，不执行初始化、
迁移或 seed。共享依赖不可探测时，诊断结果为 `unknown`，不会据此自动创建或删除实例资源。

`pnpm dev:destroy` 默认只打印影响范围。只有同时提供同一个实例 ID 才会删除该实例的 database、bucket、托管环境文件和注册记录；它不会启动或重建共享容器，也不会删除共享 source/docs bucket、网络或数据卷：

```bash
pnpm dev:destroy -- --instance <instance-id> --confirm <instance-id>
```

## 相关文档

- [Provider 与 Secret](./providers.md)
- [测试与验证](../reference/verification.md)
- [供应商密钥操作](../runbooks/provider-secrets.md)
- [Secret 投递决策](../decisions/adr-0066-secret-delivery.md)
