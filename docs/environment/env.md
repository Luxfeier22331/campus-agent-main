---
doc_type: reference
owner_boundary: docs/environment
status: active
---

# 环境文件

## 边界

本文定义本地和部署环境配置的分层规则。供应商与 Secret 所有权见
[Provider 与 Secret](./providers.md)，健康和就绪语义见 [就绪状态](./readiness.md)。精确变量由
所属应用模板、配置解析器和部署清单维护。

## 配置分层

### 仓库根环境

根 `.env` 不属于 worktree 本地开发合同，`pnpm dev`、`pnpm dev:init` 和应用开发入口都不得读取或复制它。根 worktree 中已有的被忽略文件只服务明确声明的旧命令，不能作为 linked worktree 的兜底配置源。

### 应用本地环境

应用只读取自身目录声明的环境文件。`pnpm dev:init` 为当前 worktree 原子生成以下 `0600` 文件：

- App API：`.env.local` 和 `.dev.vars.local`；
- Campus Web：`.dev.vars.local`；
- Ops Web：`.env.local`；
- Source Collector internal-portal adapter：`.env.local`。

这些文件带有管理标记，不提交 Git，也不供人工编辑；命令拒绝覆盖同路径的开发者自有文件。重新初始化保留已生成的本地应用 secret，并按当前 profile 重写端口、数据库和 bucket 地址。进程环境优先于应用文件，因此外部供应商凭据应由 shell、`op run` 或其他可选 secret manager 注入，不写入 profile 或机器注册表。

托管本地环境不连接 Turnstile：Campus Web 不渲染验证码，App API 只对本地禁用标记跳过
CAPTCHA 插件。staging 和 production 仍必须提供配套的 Turnstile site key 与 secret key。

Source Collector 的托管 `.env.local` 只保存当前 worktree 的本地对象存储配置。adapter 目录下未跟踪的
`.env` 由开发者按照同目录 `.env.example` 维护门户地址、TGC 和代理配置；不使用托管本地环境的独立
命令也可在其中提供对象存储配置。`dev:init` 不创建或覆盖该文件，进程环境仍具有最高优先级。

一个应用不得读取其他应用或适配器的环境文件，也不得从根 `.env` 隐式扩散数据库或供应商凭据。

### 命令环境

需要显式运行配置的仓库命令使用 `env/commands/*.env.example`。命令模板只保存变量名和安全示例，
不保存真实值，也不成为常驻应用的配置来源。

任务标识、来源引用、查询目标和其他单次输入通过类型化请求或 CLI 参数传递，不扩张为环境合同。

### 部署环境

Kubernetes、Cloudflare 和外部平台配置由环境仓及所属密钥存储交付。ConfigMap、Secret、平台变量
和在线模型配置各自服务明确消费者，不能互相充当同步源。

长期运行的 Kubernetes workload 从共享 ConfigMap 逐 key 投影实际消费字段。只服务单个一次性 Job
且字段全部由该 Job 消费的专用 ConfigMap 可以整体注入。

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

Campus Web 文档来源命令复用现有对象存储地址和派生桶凭据，配置文件位于
`env/commands/campus-docs-source.env`。这些值只服务本地或受信任的来源准备、正式构建和来源更新，
不投递到 PR、Worker、Wrangler 或 Argo。`CAMPUS_WEB_BUILD_TARGET` 与
`CAMPUS_WEB_DOCS_CONTENT_ROOT` 由构建脚本临时生成，也不进入环境配置。

## 读取与覆盖

本地开发统一使用“进程环境、应用 `.env.local`/`.dev.vars.local`、应用基础文件”的优先级。部署和一次性命令仍由各自解析器、Wrangler 配置或命令入口声明读取顺序。

稳定业务事实进入配置、注册表、manifest 或数据库投影。只有会随环境变化的资源地址、凭据和
运行参数才进入环境文件。

## Worktree

Git 不会把被忽略的环境文件带入新 worktree。每个 worktree 首次运行 `pnpm dev` 或显式运行
`pnpm dev:init` 时获得独立 profile、应用文件、端口、PostgreSQL database 和 derived bucket；
PostgreSQL 与 RustFS 容器和数据卷由同一机器上的 worktree 共享。应用仍只消费
`OBJECT_STORE_*`；`RUSTFS_*` 只存在于供应商容器边界，不进入应用环境合同。
Campus Web 文档合同固定使用共享 `campus-agent-derived`；`dev:init` 只在
`campus-docs/source.json` 缺失时写入确定性开发样例，不覆盖已有文档来源。worktree profile 中的
独立 derived bucket 仍只服务 Dining 等实例数据。

profile 位于当前 worktree 的 `var/dev/profile.v1.json`，机器级实例注册表位于 `${XDG_STATE_HOME:-~/.local/state}/campus-agent/<repo-key>/instances.v1.json`。两者只保存资源身份，不保存外部凭据。使用 `pnpm dev:instances` 查看分配，使用 `pnpm dev:doctor` 检查完整性。

`pnpm dev:destroy` 默认只打印影响范围。只有同时提供同一个实例 ID 才会删除该实例的 database、bucket、托管环境文件和注册记录：

```bash
pnpm dev:destroy -- --instance <instance-id> --confirm <instance-id>
```

## 相关文档

- [Provider 与 Secret](./providers.md)
- [就绪状态](./readiness.md)
- [供应商密钥操作](../runbooks/provider-secrets.md)
- [Secret 投递决策](../decisions/adr-0066-secret-delivery.md)
