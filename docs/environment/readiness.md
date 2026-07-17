---
doc_type: reference
owner_boundary: docs/environment
status: active
---
# 就绪状态

## 文档边界

本文只负责仓库环境层的就绪状态语义。

它回答的是：

- 当前仓库支持哪些环境和运行时就绪检查；
- `healthz`、`readyz`、环境检查与发布验收的边界；
- 评测供应商环境如何进入就绪检查。

它不负责：

- provider / secret 获取方式
- 具体 deploy/runbook 步骤
- staging hostname、Worker route 或 release closeout artifact inventory

相关文档：

- `README.md`
- `providers.md`
- `../runbooks/execution.md`
- `../architecture/system/runtime-release.md`
- `../reference/verification.md`
- `../runbooks/provider-secrets.md`

## 就绪检查

### 通用环境检查

```bash
pnpm exec tsx scripts/deploy/doctor-env.ts <surface> --json
```

当前支持的 surface：

- `query`
- `ingestion`
- `evals`
- `execution-control`
- `worker-observability-local`
- `worker-staging`
- `worker-staging-app-api`
- `worker-staging-campus-web`

### Execution Control 运行时

`execution-control` 环境检查独立于 Worker staging，检查当前运行配置、Temporal 连接与
Worker 身份、运行投影数据库、内部查询认证和服务凭据。

工具开放由 `configs/runtime/tools.v5.json` 和
`configs/runtime/tool-function-schemas.v2.json` 维护，不由运行配置中的 `open_tools` 字段
维护。因此，环境检查不得从已退役的运行配置结构推断工具就绪状态。

运行时 `/readyz` 比存活检查更严格：

- `200 ready`：供应商配置、运行投影、Temporal poller、记忆、知识搜索、已开放工具读取
  模型和遥测均健康，且回答准入未处于排空或饱和状态；
- `503 degraded`：至少一个执行运行时组件未就绪；
- 非 `local` 模式下，execution-control 完整 `/readyz` 需要内部 Worker 认证，不得作为未
  认证的公开部署探针；staging 对外验收使用 `app-api /readyz`，由 app-api 携带共享密钥
  检查 execution-control；
- `/readyz` 不是完整部署验收，仍需核对配置、冒烟测试和 runbook 规定的验收产物。

### App API 产品就绪状态

`app-api /readyz` 是 Worker staging 的产品侧就绪聚合点，可以展示 execution-control
就绪摘要；学生产品从 `campus-web` 进入，运维产品从独立 Ops Web 进入。

固定解释：

- `/healthz` 表示进程或 Worker 已能响应；
- `/readyz` 表示该界面依赖的运行时组件已就绪；
- `app-api /readyz` 可以返回安全的依赖状态，例如 `executionControl`、
  `executionRuntime` 和当前执行运行时发布标识；
- 环境发布后的核验必须将该标识与环境仓期望版本比对；旧版本即使健康，也不算完成部署；
- 非本地配置下，`execution-control /readyz` 是受信任的机器探针，不是公开浏览器接口；
- 文档阅读器使用 `GET /api/docs/readyz`，不代表聊天、execution-control 或运维界面就绪。

### Cloudflare 密钥存在性

```bash
pnpm exec tsx scripts/deploy/check-worker-secret-presence.ts --env staging --json
```

固定解释：

- `worker-staging` 不直接读取 Cloudflare secret store
- 发布前先过 `check-worker-secret-presence`
- publish 时再由各 app `wrangler.toml` 的 `secrets.required` 做 fail-fast

## 发布边界

就绪检查是发布的必要条件，但不等于发布完成。

固定规则：

- staging hostname、Worker route 与 release identity 由
  `docs/architecture/system/runtime-release.md` 冻结。
- executable release closeout 由 `docs/runbooks/e2e.md` 承接。
- `readyz = 200` 不等于 deploy closeout；还必须有 config truth、smoke 和
  runbook-owned closeout artifact。
- 跳过 Access / auth / readyz 或用 fallback 把 readiness 标绿都无效。

## 评测环境合同

默认规则：

- eval provider endpoint/key truth 来自 Ops Web 发布的
  `provider_config_projection.v2` artifact。
- eval runtime 不在热路径调用 Ops Web 或 app-api。
- 必需角色：`eval_ragas_llm`、`eval_ragas_embedding`、`eval_judge_llm`。
- `LLM_*`、`EMBEDDING_*`、`EVAL_LLM_*`、`EVAL_EMBEDDING_*` 不再是 eval
  provider fallback。

固定要求：

- `CAMPUS_PROVIDER_CONFIG_SNAPSHOT_PATH` 指向 0600 的 provider projection artifact。
- eval model、transport、reasoning 与 token 配置由
  `packages/eval-langfuse` runtime config builders 持有
- 临时脚本 / REPL 不自动 bootstrap `.env`
- 需要确认 eval surface 实际可见性时，优先使用：

```bash
pnpm exec tsx scripts/deploy/doctor-env.ts evals --json
```

- repo-owned shared automation doctor 入口：

```bash
pnpm --dir packages/eval-langfuse exec tsx src/cli.ts doctor --json
```

## 相关操作手册

- `docs/runbooks/execution.md`
- `docs/runbooks/e2e.md`
- `docs/runbooks/provider-secrets.md`
- `docs/runbooks/worker-otel.md`
