---
doc_type: decision
decision_id: ADR-0008
status: accepted
created: 2026-03-26
updated: 2026-03-26
---

# ADR-0008 Public Consumer Chat 前台宿主决策

适用范围：`apps/public-consumer-chat` 第一版前台应用宿主、路由宿主与 app-local server/runtime shape

## 背景

`public-consumer-chat` 已经被接受为独立 `apps/*` boundary。

这个 app 不只是一个浏览器页面壳，它还需要在同一个 app boundary 内承载：

- 页面路由
- app-level auth handler
- session 读取与保护
- conversation CRUD
- ownership guard
- 到 Worker / `apps/supervisor-api` 的 same-site runtime API seam

因此仓库需要冻结一个问题：

- 第一版 public consumer app 应该用什么前台宿主形态来承载这些能力

## 决策 1：第一版前台宿主采用 TanStack Start

结论：

- `apps/public-consumer-chat` 第一版前台宿主采用 `TanStack Start`
- 路由层采用 `TanStack Router`
- 不采用 `React Router framework mode` 作为当前默认方案

原因：

- 这个 app 需要的是 app-local full-stack boundary，而不是单独的 client router
- `TanStack Start` 能在一个 app boundary 内承载路由、server functions、SSR 和 app-local API routes，更符合前台 user/session/history 产品的真实形态
- `TanStack Router` 的类型系统、search params、route context 和 loader integration 更贴合 conversation、ownership、redirect 与 same-site app seam 这类需求
- 当前团队对 `React Router / Remix` 长期演进线的边界稳定性不持正面判断；在该前提下，不应继续把它当作默认推荐宿主

## 决策 2：不采用“单独 TanStack Router + 外挂后端壳”

结论：

- 不采用仅使用 `TanStack Router`，再把 auth/session/conversation API 放到独立外部后端壳的默认方案

原因：

- 这样会重新制造 UI route truth 与 app identity / conversation truth 的分裂
- 会把 app-level user/session/history 的核心复杂度重新抛给别处，而不是在 consumer app boundary 内收口
- 很容易诱发以下坏边界：
  - 把 conversation API 塞回 `apps/supervisor-api`
  - 额外增加一次性 BFF / custom server
  - 把 app shell 变成只有前端页面、真实业务边界在别处的空壳

因此这里冻结：

- 如果采用 TanStack 路线，应采用 `TanStack Start`
- 不是只采用 `TanStack Router`

## 决策 3：Cloudflare Worker 是接受的正式宿主目标

结论：

- `TanStack Start` 的第一版部署目标接受 `Cloudflare Workers`
- 这条路线与现有 `public-entry-worker -> supervisor-api` 边界不冲突

原因：

- 官方文档已支持 `TanStack Start` 部署到 `Cloudflare Workers`
- 这允许 consumer app 自己成为一个独立前台应用宿主，而不必反向依附 `apps/supervisor-api`
- Worker public entry 与 consumer app 前台宿主仍然是两个边界问题，不应混淆

补充说明：

- 当前接受的是 `Cloudflare Workers` 作为可行正式宿主
- 这不意味着今天就冻结最终 delivery topology 或把所有 app 都迁到同一 delivery substrate

## 决策 4：RC 状态接受，但必须显式记录

结论：

- 团队接受 `TanStack Start` 当前仍处于 `RC` 状态
- 该风险被视为显式接受的实现风险，而不是未讨论风险

执行要求：

- 锁定精确版本
- 不依赖“未来会稳定”来代替当前的边界设计
- 如果后续出现框架级破坏性变更，应优先保住 app boundary、auth boundary 和 storage boundary，而不是为宿主框架保留兼容层

## 后果

直接结果：

- 04.7 的 implementation handoff 与 app scaffold 应以 `TanStack Start` 为默认宿主
- app 内路由、auth handler、conversation API、ownership guard 都应按同一 app boundary 组织
- `Better Auth + Supabase Postgres` 的冻结决策继续有效，并与此前 ADR-0007 组合使用

明确不做：

- 不把 consumer app 退回成纯前端壳
- 不把 app auth / conversation API 回灌到 `apps/supervisor-api`
- 不因为使用 TanStack 就把 Cloudflare edge/runtime concerns 推进 `packages/*`

## 相关文档

- `docs/architecture/public-consumer-chat-surface.md`
- `docs/architecture/public-consumer-chat-auth-and-data-boundary.md`
- `docs/decisions/adr-0007-public-consumer-auth-and-storage.md`
