---
doc_type: runbook
status: active
created: 2026-03-29
updated: 2026-03-31
---

# Forward Worker Surface Smoke Runbook

## 文档边界

这份 runbook 只记录当前 forward product topology 的最小 smoke 入口：

- `apps/app-api`
- `apps/public-chat-web`
- `apps/protected-panel-web`

它回答的是：

- 当前仓库里哪组命令可以稳定验证 forward Worker surfaces
- 这些 smoke 证明了什么
- 这些 smoke 还没有证明什么

它不替代：

- 长期拓扑边界：`docs/architecture/shared-app-api-and-worker-web-surfaces.md`
- `app-api` 内部边界：`docs/architecture/app-api-architecture.md`
- protected panel operator access：`docs/architecture/protected-panel-operator-access.md`
- 当前 phase 状态：`.planning/PROJECT.md`、`.planning/STATE.md`

## 当前 smoke 形态

当前 repo 还没有把 `public-chat-web -> app-api` 与 `protected-panel-web -> app-api` 的本地多 Worker 联调拓扑固化成一个统一 `pnpm smoke` 脚本。

因此，当前 canonical smoke 入口是基于 Worker runtime 的 targeted vitest 用例，而不是任何已退役的 standalone public chat app live smoke。

## 前置条件

- 已完成依赖安装
- 本地可执行 `pnpm`
- 运行 Worker 测试时允许本地监听端口
- 为避免 `wrangler` 写入默认家目录日志，命令使用 repo-local `XDG_CONFIG_HOME=./.wrangler-home`

## 标准命令

先验证 shared `app-api` Worker runtime：

```bash
pnpm --dir apps/app-api test:worker -- --reporter=verbose
```

再验证 public chat 主链路 smoke：

```bash
pnpm --dir apps/public-chat-web test:worker -- --reporter=verbose -t "smokes a chat request through public-chat-web into app-api"
```

最后验证 protected panel 请求查询链路 smoke：

```bash
pnpm --dir apps/protected-panel-web test:worker -- --reporter=verbose -t "smokes request queries through protected-panel-web into app-api with internal caller admission"
```

## 这组 smoke 证明什么

- `app-api` 的 `GET /healthz` 与 `GET /readyz` 正常
- `app-api` 的 fail-closed readiness 门禁正常工作
- `public-chat-web -> app-api` 的 same-site chat request 链路可用
- `protected-panel-web -> app-api` 的 operator request query 链路可用
- protected panel 到 `app-api` 的 trusted internal bridge admission 正常
- 三个 Worker surface 的动态响应都保持 `Cache-Control: no-store`

## 这组 smoke 不证明什么

- 不证明浏览器 UI 已完成端到端验收
- 不证明本地多 Worker dev server 拓扑已经固化
- 不证明真实数据库、真实 Better Auth session 或真实 supervisor live execution 已接通
- 不证明 retrieval、grounding 或答案质量达标

## 与旧 smoke 的关系

- 已退役 standalone public chat app 的 live smoke 不再是 forward product topology 的 canonical smoke 入口
- 如果未来要增加真正的 browser/live smoke，应围绕 `public-chat-web`、`protected-panel-web` 和 shared `app-api` 重新设计
