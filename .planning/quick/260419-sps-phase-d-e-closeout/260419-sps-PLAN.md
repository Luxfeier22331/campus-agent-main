# Quick Task 260419-sps Plan

## Goal

关闭 `shared product surfaces acceptance / hardening` workstream 剩余的 Phase D / E：

- 用 browser smoke 完成 integrated acceptance
- 用 staging preflight 完成 closeout 准备
- 把 continuity 挂回 workstream-native planning truth

## Scope

- local public chat browser smoke
- protected panel browser smoke
- chat-to-panel integrated acceptance
- staging preflight for `app-api` / `public-chat-web` / `protected-panel-web`
- evidence 与 planning truth closeout

## Non-Goals

- 改写 shared product topology
- 打开 `Jobs` / `Operations` / `Audit`
- 把 `official_web`、`authenticated_notice` 或 regulation data-plane 工作混进来
- 把 panel smoke 默认改写成 service-token / managed-OAuth 自动化
- 把 staging preflight 冒充成 staging smoke

## Execution Order

1. 固定 browser evidence contract。
2. 完成 public chat browser smoke。
3. 完成 protected panel browser smoke。
4. 执行 chat-to-panel integrated acceptance。
5. 执行 staging preflight。
6. 更新 workstream state 与 evidence pointers。

## Steps

### 1. Freeze Browser Evidence Contract

- 浏览器执行继续使用可见浏览器会话与 `mcp__playwright__` 取证。
- 证据以 user-visible checkpoint 为主：
  - `/login`
  - `/chat`
  - 首次发送
  - sidebar / history 更新
  - reload 后 history 保持
  - panel `Overview`
  - panel `Requests`
  - panel `Official Web`
- 允许记录：
  - HTTP 状态码摘要
  - `conversationId`
  - `requestId`
  - `traceId`
  - 截图文件名
- 禁止记录：
  - 明文密码
  - cookie
  - authorization
  - session token
  - 整段 request/response body

### 2. Public Chat Browser Smoke

- 使用 canonical local topology：
  - `pnpm --dir apps/public-chat-web dev:live-smoke`
- 若登录链路阻塞，先按现有 runbook provision smoke identity。
- 完成以下最小动作：
  - 登录
  - 进入 `/chat`
  - 发送一条真实请求
  - 观察 sidebar/history 更新
  - reload 后确认会话仍在
- 记录：
  - `conversationId`
  - `requestId`
  - `traceId`
  - redacted screenshots

### 3. Protected Panel Browser Smoke

- 通过真实 Cloudflare Access 浏览器准入进入 panel。
- 只验证当前开放域：
  - `Overview`
  - `Requests`
  - `Official Web`
- 明确不验证：
  - `Jobs`
  - `Operations`
  - `Audit`
- 若失败，优先按以下归因分类：
  - Access session / Access config
  - operator allowlist / admission
  - `apps/app-api` runtime seam
  - `apps/protected-panel-web` surface defect

### 4. Integrated Acceptance

- 在 public chat 发起一条真实请求。
- 在 panel `Requests` 中找到同一条 projection。
- 验证最小消费面：
  - request row 可见
  - request detail 可见
  - 状态与问题摘要可被 operator surface 消费
- integrated failure 只能归到明确 owner，不接受“先在 panel 侧做临时拼装”。

### 5. Staging Preflight

- 顺序执行：
  - `pnpm --dir apps/app-api deploy:preflight:staging`
  - `pnpm --dir apps/public-chat-web deploy:preflight:staging`
  - `pnpm --dir apps/protected-panel-web deploy:preflight:staging`
- 同步检查 runbook 中的 staging invariants：
  - hostname
  - service binding
  - Hyperdrive binding
  - DB migration / drift reconcile prerequisites
  - secrets presence
  - supervisor upstream injectability
  - Access team domain / policy aud
  - smoke identity reset prerequisites
- preflight 结果只允许写成：
  - `pass`
  - `blocked with classified cause`

### 6. Planning Closeout

- 把这次 quick plan 挂回 workstream-native `STATE.md`。
- 将 evidence 路径写回：
  - `.tmp/local-smoke/...`
  - `.tmp/staging-smoke/...`
- 若仍有未闭合项，只允许归入以下四类：
  - `local shared seam defect`
  - `Access / operator admission`
  - `staging environment / secret / binding`
  - `supervisor upstream availability`

## Verification Commands

```bash
pnpm --dir apps/public-chat-web dev:live-smoke
```

```bash
pnpm --dir apps/app-api deploy:preflight:staging
pnpm --dir apps/public-chat-web deploy:preflight:staging
pnpm --dir apps/protected-panel-web deploy:preflight:staging
```

## Success Criteria

1. public chat browser smoke 已以真实登录、真实发送、reload/history evidence 证明 same-site product path 成立。
2. protected panel 已以真实浏览器准入证明 `Overview`、`Requests`、`Official Web` 三个开放域可用。
3. 至少一条 public chat request 能在 panel `Requests` 中被同一条 projection 消费。
4. 三端 staging preflight 已通过，或每个阻塞都被明确分类且没有被误写成产品 bug。
5. workstream-native `STATE.md` 已指向本次 D/E quick plan，后续会话不再需要回退到 flat `STATE` continuity。

## Closeout Rule

只有当第 1-4 条都成立时，这条 workstream 才能从 Phase D 进入 Phase E closeout，或直接标记为完成。

如果只完成了 local browser smoke 与 integrated acceptance，但 staging preflight 未闭合，则状态保持在：

- `Phase E in progress`

而不是：

- `completed`
