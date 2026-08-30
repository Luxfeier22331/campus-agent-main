---
doc_type: runbook
owner_boundary: local-development
status: active
---

# 本地运行检查

## 边界

本地开发使用 `infra/local/docker-compose.dev.yml` 提供共享 PostgreSQL、RustFS 和 Temporal；仓库不在
Kubernetes/GitOps 之外维护第二套 staging 生命周期。`docker-compose.execution-runtime.yml` 只用于按需
启动 Hindsight 与 OTel 诊断依赖。

未配置 Hindsight 时，execution-control 不向模型暴露 `personal_memory_recall`，普通对话仍使用真实
模型链路；验证个人记忆时再显式启动并配置 Hindsight。

产品页面本地开发使用 worktree profile 和应用本地托管环境文件，不读取根 `.env`。仓库生成 loopback
数据库凭据和应用本地随机 secret；linked worktree 的 target 按 projection 白名单补充尚未存在的 provider
外部开发连接，并在 `internal-portal-collection` projection 下首次导入 main 已有的门户 TGC。数据库、
对象存储资源、应用内部 secret 和 provider 配置加密 key 仍按 worktree 独立。其他外部凭据由开发者进程环境显式提供。

默认诊断 compose 使用 debug OTel Collector。只有验证本地 Agent trace 到 Langfuse 的转发时加入
`docker-compose.execution-runtime.langfuse.yml`。

## Worker 检查

```bash
pnpm --dir apps/app-api test:worker -- --reporter=verbose
pnpm --dir apps/campus-web test:worker -- --reporter=verbose
```

## Campus Web 与文档阅读

```bash
pnpm --dir apps/campus-web test:node:fast
pnpm --dir apps/campus-web build:test
pnpm dev:shared-reconcile
pnpm dev:init -- --target core
pnpm dev
```

`build:test` 只供浏览器回归使用确定性测试内容。Campus Web 的正常开发和构建读取对象存储固定键
`campus-docs/source.json`。共享依赖只由 canonical checkout 的 `pnpm dev:shared-reconcile` 供应；
`pnpm dev:init -- --target core` 为当前 worktree 创建实例资源，在来源键缺失时写入确定性开发样例，
并安装核心 schema/seed 和 Temporal namespace。`pnpm dev` 随后只读取就绪状态，并由 Turbo 并行启动
Campus Web、app-api、execution-control 和 agent-runtime。它不隐式执行初始化、迁移或 seed。
直接执行 `pnpm --dir apps/campus-web build` 也会读取当前 worktree 的托管配置。只有显式访问其他对象
存储时才通过 `env/commands/campus-docs-source.env` 或进程环境覆盖，进程环境优先级最高。

文档准备进程读取对象存储配置并生成按来源摘要命名的本地目录；随后启动的 Vite 进程只接收该目录、
构建目标和页面运行所需配置，不接收对象存储凭据。没有对象存储访问时，应使用 `build:test` 和
Worker fixture 检查，不要把测试环境改成读取远端文档。

初始化失败时运行：

```bash
pnpm dev:doctor
pnpm dev:instances
```

`pnpm dev:doctor` 默认检查当前 target 的配置、实例资源和 owner readiness；使用
`pnpm dev:doctor -- --scope shared` 才检查共享容器运行状态、健康检查、Compose 配置 hash、网络、数据
卷和共享 bucket，`--scope runtime` 还检查当前 target 的 HTTP health endpoint。无法探测时显示 `unknown`，
不会把连接失败当成资源不存在。主 checkout 负责首次启动或重新协调共享容器，linked worktree 只复用
ready 状态的共享依赖。Temporal namespace 按 profile 创建；实例的 derived bucket 只在 target 声明需要时
供应，notice-classifier 等 database-only target 不会无条件创建它。

`pnpm dev:instances` 是 metadata-only 清单，只读取注册表，不访问 PostgreSQL、RustFS 或 Temporal；
`pnpm dev:instances -- --verify` 才为每条记录探测 worktree、database、derived bucket 和 namespace。
默认清单中的记录显示为 `registered` 或 `stale`，验证清单显示 `ready`、`stale`、`partial`、`unprovisioned` 或
`unknown`。worktree 已删除但资源仍存在时只标记
为 `stale`，不会自动清理。先用 `pnpm dev:prune` 列出 stale 记录，再确认单个实例 ID 后执行：

```bash
pnpm dev:destroy -- --instance <instance-id> --confirm <instance-id>
```

删除 linked worktree 前，先运行上述销毁命令；不要在任一 worktree 执行共享 compose 的 `down` 或
`down -v`。source bucket 与 Campus Web 文档 bucket 是共享资源，不能作为单个实例销毁目标。
单独启动核心应用要求当前 worktree 已执行 `pnpm dev:init -- --target core`；可选应用统一使用根入口，
例如 `pnpm dev:init -- --target ops-web`。target 会生成真实依赖的环境投影；
internal-portal-collection 和 notice-classifier 不需要再单独运行 notice-publisher 初始化。

## 可选应用

可选应用不由根 `pnpm dev` 启动，初始化仍由根 CLI 拥有：

```bash
pnpm dev:init -- --target ops-web
pnpm --filter ops-web dev:api
pnpm --filter ops-web dev:web
pnpm dev:init -- --target notice-publisher
pnpm dev:init -- --target internal-portal-collection
pnpm dev:init -- --target notice-classifier
```

`notice-publisher` target 是通知 schema/category seed 的 owner；`internal-portal-collection` 只生成
Ops Web 和采集器实际读取的环境投影，`notice-classifier` 只生成 Model Config 与分类器实际读取的环境投影。
两者都通过 readiness 检查复用统一 schema 和通知分类 seed，但不重复执行 DDL。

## Ops Web API

Ops Web 的页面和 Node API 分别启动；只验证服务端接口时，在一个终端运行：

```bash
pnpm --filter ops-web dev:api
```

另一个终端可检查进程和核心就绪边界：

```bash
curl -sS http://127.0.0.1:<ops-api-port>/healthz
curl -sS http://127.0.0.1:<ops-api-port>/readyz
```

将 `<ops-api-port>` 替换为当前 worktree profile 的本地 `PORT` 配置，或使用
`pnpm dev`/独立 API 命令输出的地址。local/development 的 `/readyz` 不要求 Cloudflare Access，但仍
要求本地公开 origin 和 Ops Web 状态数据库。自动化 origin 不影响该结果；未配置时仅自动化 token
管理区和机器接口返回 `OPS_AUTOMATION_NOT_CONFIGURED`。

需要验证真实 HTTP、Bearer、TGC 刷新和 CAS 失败语义时，使用隔离 fixture：

```bash
pnpm --filter ops-web dev:fixture
```

命令只监听 `127.0.0.1`，启动输出包含临时 endpoint、fixture token 和凭据 ID。fixture 使用内存存储
和固定测试响应，不读取真实门户凭据，也不代表 staging 或 production 状态。MCP 调用应与该进程
处于同一网络命名空间，并使用输出的 loopback endpoint。

## Model Config

在线配置由当前 worktree 的独立 Model Config 数据库、role 和 `model-config-encryption.key` 持有。
`pnpm dev:init -- --target core` 或 `--target notice-classifier` 会按 target 从当前进程环境或根 `.env` 显式
seed 缺失的 Model Config；它不访问 Provider、不覆盖已有配置，也不产生 validation 记录。需要在线修改或
验证时，启动本地 `pnpm dev` 与 `pnpm --filter ops-web dev:api`、`pnpm --filter ops-web dev:web`，按
`provider-secrets.md` 操作。应用启动不能静默 seed 在线配置。main checkout 导入的 provider 字段只是
初始化输入，不是 runtime source；映射由 target 声明的 config name 决定，通用 LLM 连接不会隐式覆盖已有
通知分类配置。`notice_classification` 本地 seed 使用独立的
`NOTICE_CLASSIFICATION_BASE_URL`、`NOTICE_CLASSIFICATION_API_KEY` 和
`NOTICE_CLASSIFICATION_MODEL` 输入；当前开发环境中 endpoint 与 API key 暂时与
`primary_agent` 相同，模型为 `deepseek-v4-flash-0731`。这只是初始化时的当前值，不把两个
配置合并，也不改变通知消费者逻辑。
`pnpm dev:init -- --target core` 通过 `campus-agent-schema` 为新建或重建的本地数据库安装统一 baseline，不再执行
execution-control 历史 Goose migration、Model Config 切换命令，也不生成 legacy provider key。启动前
会在 seed 后检查当前 Model Config 密文可由 `model-config-encryption.key` 解密；失败说明数据库和 key 不属于
同一个本地实例。不要复制其他 worktree、staging 或 production 的 encryption key；使用
`pnpm dev:destroy -- --instance <instance-id> --confirm <instance-id>` 显式销毁该实例后重新运行
`pnpm dev:init -- --target core`，再通过 Ops Web 配置本地模型。

## Campus Web 浏览器回归

浏览器业务回归只在本地执行，不进入 GitHub Actions：

```bash
pnpm --dir apps/campus-web test:e2e:smoke
pnpm --dir apps/campus-web test:e2e:full
```

需要验证真实 Campus Web Worker、真实 App API Worker、Service Binding 和本地数据库之间的聊天链路时，
显式运行：

```bash
pnpm --dir apps/campus-web test:e2e:dev:chat
```

该命令会在当前 worktree profile 的端口上启动确定性的 execution-control HTTP fixture、App API Wrangler
和 Campus Web Wrangler。fixture 只读取本地 `APP_API_EXECUTION_SHARED_SECRET`，校验 App API 冻结输入的原始
SHA-256，并在产品回调成功后发布终结事件；它不会连接 staging、Cloudflare 远端资源或真实模型。
测试覆盖本地登录、普通回答、重新生成、记忆设置路由和 `GET /api/me/profile-memory`。

这是本地用户行为和依赖协议证据，不代表 staging、production、部署控制器或真实 execution-control 已经
健康。命令结束后 Playwright 会停止本次启动的 fixture 和两个 Wrangler 进程；共享本地 Postgres、RustFS
和 worktree profile 不由该命令销毁。

Temporal 工作流 E2E 按需在本地执行。测试会启动 Temporal Dev Server，不连接 staging 或其他部署环境：

```bash
go -C apps/execution-control test -tags=temporal_e2e ./internal/temporalruntime ./internal/httpapi -count=1
```
