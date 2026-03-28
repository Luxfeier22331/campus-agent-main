---
doc_type: architecture
status: active
created: 2026-03-25
updated: 2026-03-28
---

# Cloudflare 公网入口边界

## 文档边界

这份文档只冻结 Cloudflare public entry 的长期边界，不负责具体实现运行时，也不替代以下文档：

- 长期 `apps/` 与 `packages/` 分层：`docs/architecture/long-term-architecture.md`
- supervisor 边界与编排职责：`docs/architecture/supervisor-architecture.md`
- shared app backend 与 web surfaces：`docs/architecture/shared-app-api-and-worker-web-surfaces.md`
- `app-api` runtime 与内部边界：`docs/architecture/app-api-architecture.md`
- protected internal panel 的信任模型：`docs/architecture/protected-internal-panel-boundary.md`

## 目标

本文只收口三件事：

- Cloudflare 是 public entry 的 edge/control boundary，位于 public web surface 之前。
- 系统采用 two-surface 模型：一个 public entry surface，一个 separate protected internal panel surface。
- Cloudflare does not own supervisor routing、specialist delegation、retrieval semantics；进入 repo 后仍必须沿 `public-chat-web -> app-api -> supervisor-api -> supervisor-core` 的链路前进。

## 边界结论

公共用户流量的长期形态固定为：

`client -> Cloudflare public entry -> apps/public-chat-web -> apps/app-api -> apps/supervisor-api -> packages/supervisor-core -> specialist -> downstream capability`

在这条链路里：

- Cloudflare 负责公网暴露、DNS/TLS、hostname split、edge admission 和外层保护策略。
- `apps/public-chat-web` 是 browser-facing public runtime origin。
- `apps/app-api` 是 shared application backend，承接 public chat ingress。
- `apps/supervisor-api` 仍是 internal execution engine，而不是 public browser origin。
- `packages/supervisor-core`、`packages/contracts`、`packages/rag-specialist` 和 retrieval/data-plane packages 不因为本文而改变职责。

这意味着 Cloudflare 是 entry boundary，不是新的 edge orchestrator。任何把 routing、delegation、query policy 或 retrieval decision 上提到边缘层的设计，都不属于本文接受范围。

## Two-Surface Model

### Public entry

- 面向外部用户或产品调用方。
- 通过 Cloudflare 暴露公网 hostname。
- 只把请求送入 `apps/public-chat-web` 对应的 public runtime origin，并在后续通过受控内部 runtime seam 进入 `apps/app-api` 与 `apps/supervisor-api`。

### Protected internal panel

- 是 separate protected internal panel surface，不复用 public entry 的 exposure model。
- 由独立受保护 hostname/surface 承载。
- 详细 trust model 见 `docs/architecture/protected-internal-panel-boundary.md`。

这两个 surface 在 Cloudflare 层分开，但在 monorepo 内都必须尊重 `apps/*` 作为 runtime boundary、`packages/*` 作为稳定能力边界的长期约束。

## 路由与责任矩阵

| Surface | Public reachability | Cloudflare owns | Repo-owned runtime owns | Explicit non-ownership |
| --- | --- | --- | --- | --- |
| Public entry | Yes | DNS/TLS, WAF/admission, hostname, edge request forwarding | `apps/public-chat-web` public ingress, `apps/app-api` chat ingress, and the controlled runtime path into `apps/supervisor-api` | Cloudflare does not own supervisor routing, specialist delegation, retrieval semantics |
| Protected internal panel | No, non-public by default | Separate protected hostname, outer access protection envelope | `apps/protected-panel-web` and the runtime APIs it is allowed to call | Panel surface does not bypass `apps/app-api` or call `packages/*` directly |

## Public Runtime Chain

Cloudflare front 的 browser-facing 对象是 `apps/public-chat-web`，不是 `packages/supervisor-core`，也不是某个直接暴露 specialist 的边界。

因此这里明确锁定：

- Cloudflare 之前是 public network / edge control boundary。
- Cloudflare 之后首先进入 `apps/public-chat-web`。
- public chat 请求再通过 `apps/app-api` 进入 `apps/supervisor-api`。
- `apps/supervisor-api` 再把 supervisor-facing request 交给 `packages/supervisor-core`。
- public entry 不允许直接构造或暴露 `packages/contracts` 内部 handoff。

## 对核心 package 的影响

本文不授权以下边界变化：

- 不修改 `packages/contracts` 的 schema 形状来适配 Cloudflare。
- 不把 Cloudflare、hostname、DNS、WAF 或 provider-specific access types 下沉进 `packages/supervisor-core`。
- 不把 `packages/rag-specialist`、`packages/retrieval-core` 或 `packages/ingestion-core` 变成 edge-facing implementation detail。

## 与后续治理的关系

这份文档只冻结 public entry boundary，不关闭后续身份与治理问题。

仍需由后续治理阶段关闭的事项包括：

- `SupervisorRequest.actor` 的请求级身份传播。
- retrieval 前 ACL / policy filtering。
- audit / trace 的扩展字段、归档位置与治理口径。

Cloudflare 的 access envelope 不能替代应用层身份、ACL 和审计闭环。

## 非目标

- 不在本文选择或更换长期 runtime/framework。
- 不把 Cloudflare 扩展成 edge-orchestrator design。
- 不新增 public answer 之外的业务入口协议。
- 不改变 `packages/*` 边界，也不在这里关闭 ACL/audit 治理工作。
