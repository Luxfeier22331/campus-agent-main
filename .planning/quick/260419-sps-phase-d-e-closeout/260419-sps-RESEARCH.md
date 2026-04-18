# Quick Task 260419-sps Research

**Task:** 结合 repo 当前 truth 与官方资料，为 `shared product surfaces acceptance / hardening` workstream 的 Phase D / E 产出 integrated acceptance 与 staging closeout 计划。  
**Gathered:** 2026-04-19  
**Status:** complete

## Repo Truth

- 当前 repo 已切到 workstream-native planning：
  - `.planning/WORKSTREAMS.md`
  - `.planning/workstreams/shared-product-surfaces-acceptance-hardening/STATE.md`
  - `.planning/workstreams/shared-product-surfaces-acceptance-hardening/ROADMAP.md`
  - `.planning/workstreams/shared-product-surfaces-acceptance-hardening/REQUIREMENTS.md`
- 这条 workstream 当前状态已经明确：
  - Phase A-C 已完成
  - 当前处于 Phase D
  - 当前缺口是 browser smoke、chat-to-panel integrated acceptance、以及 staging preflight closeout
- 当前 success criteria 已冻结：
  - `apps/app-api` 的 auth/session/chat ingress/request projection/operator query 基线成立
  - public chat 的 same-site path、首次发送、reload/history 稳定
  - protected panel 只验证 `Overview`、`Requests`、`Official Web`
  - public chat 发起的真实请求能在 panel `Requests` 中被同一条 projection 消费
  - staging preflight 不能冒充 staging smoke
- panel runtime seam 也已经冻结：
  - 当前允许的 panel-facing runtime surface 只有 `Overview`、`Requests`、`Official Web`
  - `Jobs`、`Operations`、`Audit` 不在这轮 acceptance 范围内
- 当前 local smoke / staging preflight runbook 已存在：
  - `docs/runbooks/forward-worker-surface-smoke-runbook.md`
  - `docs/runbooks/staging-worker-deploy-runbook.md`
  - `docs/runbooks/public-chat-staging-smoke-artifact-template.md`

## Repo-Local Planning Drift To Respect

- `docs/plans/shared-product-surfaces-acceptance-hardening.md` 仍保留对旧 `.planning/STATE.md` 入口的表述。
- 当前 repo 的前向 planning truth 已经迁到：
  - `.planning/WORKSTREAMS.md`
  - `.planning/workstreams/shared-product-surfaces-acceptance-hardening/*`
- 因此，这次计划应把新的 quick artifact 挂到 workstream-native state 上，而不是继续扩大 legacy-flat 依赖面。

## Official Inputs

### Playwright

- Playwright 官方 authentication 文档明确推荐：
  - 先完成一次真实登录
  - 把认证态保存为 `storageState`
  - 后续测试复用该认证态，而不是每次都重走登录流程
- Playwright 官方 best practices 明确强调：
  - 优先测试 user-visible behavior
  - 保持测试独立
  - 避免把实现细节当成主要断言目标

对这条 workstream 的直接含义：

- 当前缺的不是更多 worker/unit 级断言，而是 browser-level、user-visible integrated evidence。
- public chat 与 protected panel 的 smoke 应围绕登录、页面进入、请求提交、列表消费、reload/history 这些可见行为建立，而不是追加内部 API 探测。

### Cloudflare Access

- Cloudflare Access session management 文档把会话划分为全局 token 与应用 token；用户会在应用 token 过期后被重新要求认证。
- Cloudflare Access managed OAuth 文档说明：
  - 默认非浏览器客户端通常会被 302 到登录页
  - 打开 managed OAuth 后，可以让 Access 把未认证访问改成 401，并返回 OAuth discovery / authorization 信息
- Cloudflare service tokens 文档说明：
  - 机器到机器访问可以使用 Client ID / Secret
  - 请求通过后，Access 仍会发放 `CF_Authorization` cookie

对这条 workstream 的直接含义：

- 当前 protected panel staging acceptance 的默认路径仍应是“真实浏览器 + 真实 Access session”。
- managed OAuth 或 service token 可以作为未来自动化扩展，但不应重写这条 workstream 当前的人类 operator smoke 基线。
- 这也和本地 smoke 经验一致：panel 的真实准入问题往往出在 Access / allowlist / operator admission，而不是 UI 本身。

### Cloudflare Workers / Hyperdrive / Secrets

- Hyperdrive local development 文档明确说明：
  - `wrangler dev` 本地模式会使用 `localConnectionString`
  - 本地模式不使用 Hyperdrive query caching
  - `wrangler dev --remote` 会使用已部署的 Hyperdrive，并产生真实 side effects
- Workers secrets 文档明确说明：
  - secrets 是 Worker 环境变量的一种安全形态
  - 敏感配置应通过 secret/binding 管理，而不是写成 repo 常量

对这条 workstream 的直接含义：

- local integrated acceptance 不能替代 staging runtime truth。
- staging Phase E 必须显式拆成：
  - preflight：配置、binding、secret、migration、upstream、Access truth 校验
  - real smoke：真实 staging hostname + 真实 Access/browser path
- 如果只做了 preflight，就只能写 preflight closeout，不能写成 staging smoke complete。

## Planning Conclusions

### 1. 当前 Phase D 的核心缺口是 browser evidence，不是新的代码范围

- A-C 基线已经通过。
- D 的主要动作应是：
  - public chat browser smoke
  - protected panel browser smoke
  - chat-to-panel integrated acceptance

### 2. protected panel 继续按浏览器准入来验收

- 当前默认不把 service token / managed OAuth 自动化纳入本 workstream 的 required scope。
- 如果后续需要无人值守 panel smoke，应单开 follow-up，不覆盖这次 D/E 计划。

### 3. Phase E 必须严格区分 preflight 与 smoke

- preflight 证明：
  - repo config
  - Cloudflare env/binding/secret
  - staging DB / Hyperdrive / Access / upstream prerequisites
- smoke 才证明：
  - 真实 staging product path 可用

### 4. planning closeout 应跟随 workstream-native 结构

- 本次 quick artifact 应作为 workstream Phase D/E 的执行计划被挂回：
  - `.planning/workstreams/shared-product-surfaces-acceptance-hardening/STATE.md`
- 不继续把当前 workstream 的 continuity 绑定到旧 `.planning/STATE.md`

## Sources

### Repo-local

- `.planning/WORKSTREAMS.md`
- `.planning/workstreams/shared-product-surfaces-acceptance-hardening/STATE.md`
- `.planning/workstreams/shared-product-surfaces-acceptance-hardening/ROADMAP.md`
- `.planning/workstreams/shared-product-surfaces-acceptance-hardening/REQUIREMENTS.md`
- `.planning/workstreams/shared-product-surfaces-acceptance-hardening/protected-panel-runtime-api-inventory.md`
- `docs/plans/shared-product-surfaces-acceptance-hardening.md`
- `docs/runbooks/forward-worker-surface-smoke-runbook.md`
- `docs/runbooks/staging-worker-deploy-runbook.md`
- `docs/runbooks/public-chat-staging-smoke-artifact-template.md`

### Official

- Playwright auth: https://playwright.dev/docs/auth
- Playwright best practices: https://playwright.dev/docs/best-practices
- Cloudflare Access session management: https://developers.cloudflare.com/cloudflare-one/access-controls/access-settings/session-management/
- Cloudflare Access managed OAuth: https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/managed-oauth/
- Cloudflare service tokens: https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/
- Cloudflare Hyperdrive local development: https://developers.cloudflare.com/hyperdrive/configuration/local-development/
- Cloudflare Workers secrets: https://developers.cloudflare.com/workers/configuration/secrets/
