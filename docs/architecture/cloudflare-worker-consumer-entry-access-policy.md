---
doc_type: architecture
status: active
created: 2026-03-25
updated: 2026-03-25
---

# Cloudflare Worker Consumer Entry Access Policy

## 文档边界

这份文档只冻结 Phase 04.5 的 Cloudflare Worker consumer-entry 与 access-policy 边界，不负责实现 Worker package、Cloudflare 配置细节或应用层身份治理，也不替代以下文档：

- public entry 的边界归属：`docs/architecture/cloudflare-public-entry-boundary.md`
- public entry 到 runtime origin 的 integration contract：`docs/architecture/cloudflare-public-entry-integration-contract.md`
- public/protected surface 的 topology：`docs/architecture/cloudflare-runtime-topology.md`
- protected panel 的 trust model：`docs/architecture/protected-internal-panel-boundary.md`
- 长期 `apps/*` / `packages/*` 分层：`docs/architecture/long-term-architecture.md`
- supervisor runtime shell 与 core 分层：`docs/architecture/supervisor-architecture.md`

## 目标

Phase 04.5 在这里冻结的是 public answer path 的 consumer-entry 形态与最小 access policy：

- Cloudflare Worker 作为唯一 public consumer-entry shell
- `authenticated-only` 与 `anonymous-enabled` 两种入口模式
- `public hostname -> Cloudflare Route -> Cloudflare Worker -> trusted origin/apps/supervisor-api` 这条 runtime seam
- Worker-to-origin trust、fail-closed posture，以及 alternate public entrypoint closure

## Consumer Entry Conclusion

public answer path 在 04.5 固定为：

`public hostname -> Cloudflare Route -> Cloudflare Worker -> trusted origin/apps/supervisor-api -> packages/supervisor-core -> specialist`

这条链路里的关键结论是：

- Cloudflare Worker 是 public consumer entry，不是 edge orchestrator。
- public hostname 继续挂在现有 Cloudflare zone/hostname 上，由 Route 命中 Worker，而不是把 Worker 建模成新的最终 origin。
- Worker 之后首先进入 `apps/supervisor-api`，而不是 `packages/*`。
- Worker 可以决定是否允许进入 public answer path，但不能吸收 supervisor routing、specialist delegation 或 retrieval semantics。
- origin 不应被视为直接 public reachable truth；它只作为 trusted Worker behind-origin 存在。

## Entry Modes

### `authenticated-only`

- public hostname 进入 Worker 后必须先通过 access gate。
- 当前接受的 edge posture 是 Cloudflare Access 外层保护加 Worker-side JWT validation。
- Worker 在 authenticated-only 模式下 only forwards validated requests to origin。
- Worker-side validated identity 仍然只是 runtime-boundary material，不等于最终 `SupervisorRequest.actor`。

### `anonymous-enabled`

- public hostname 允许匿名进入 Worker。
- 匿名是否允许必须由一个 explicit Worker flag 控制，例如 `WORKER_ALLOW_ANONYMOUS=true`。
- `anonymous-enabled` 不得通过 Access `Bypass` 之类的基础设施例外来偷渡实现。
- 即使允许匿名，Worker 也只能转发到 trusted origin，不得因此把 origin 当作公开服务边界。

## Worker-To-Origin Trust

Worker-to-origin trust 在 04.5 固定为 runtime seam，而不是 actor seam。

因此这里冻结：

- Worker 到 origin 必须携带显式 trust material，例如 `X-Worker-Origin-Auth`。
- trust material 应来自 Worker secret，而不是硬编码在 repo 中。
- origin 在缺失、错误或无效 trust material 时必须 reject request。
- Worker-projected identity、mode、trace 或 correlation metadata 仍只是 runtime-boundary context，不得被宣称为应用层 actor 真相。

## Request Identity Vs App Identity

04.5 必须继续维持两层信息分离：

- request-id / trace / runtime-boundary identity projection
- app-layer actor identity

因此这里明确：

- Worker 可以补齐或透传 request correlation context。
- Worker 可以投影“此请求来自 validated user”或“此请求来自 anonymous-enabled mode”这类 runtime-boundary facts。
- Worker 不得宣称自己已经完成 `SupervisorRequest.actor`、retrieval ACL 或 audit semantics。

这些仍属于 Phase 5。

## Fail-Closed Rules

04.5 的 public consumer entry 默认 posture 必须是 `fail-closed`。

至少以下情况必须拒绝请求，而不是静默放行：

- `authenticated-only` 模式下缺失 Access/JWT 验证配置
- JWT 无效、缺失或校验失败
- Worker origin secret 缺失
- `authenticated-only` 与 `anonymous-enabled` 相关 mode flags 互相冲突
- origin 缺失 `X-Worker-Origin-Auth`
- 配置丢失导致无法确认 trusted origin

fail-closed 的目标是保证 public entry 不会因为配置缺口而降级成“任何请求都能直通 origin”。

## Alternate Public Entrypoint Closure

如果 Cloudflare Worker 被声明为唯一 public consumer-entry shell，就必须显式关闭其他公共侧入口。

因此这里冻结：

- `workers.dev = false`
- `preview_urls = false`

如果未来确有例外，也只能是 separately protected exception，而不是默认开启的第二公共入口。

## Protected Panel Separation

04.5 不改变 public entry 与 protected internal panel 的双表面模型。

必须继续保持：

- public answer path 走 public consumer entry
- protected panel 走 separate protected hostname/surface
- 任何 panel、admin 或 operator concerns 都不能借 04.5 合并到 public entry

## 对核心 package 的限制

这份文档不授权以下变化：

- 不修改 `packages/contracts` 来表达 Cloudflare provider metadata
- 不把 Worker、Access、JWT、Route、`workers.dev` 或 preview URL concerns 推入 `packages/*`
- 不让 `packages/supervisor-core` 吸收 public entry access policy
- 不把 `packages/rag-specialist`、`packages/retrieval-core` 或 `packages/ingestion-core` 变成 edge-facing implementation detail

## 与 Phase 5 的关系

04.5 明确不解决：

- app-layer actor / ownership 真相
- `SupervisorRequest.actor`
- retrieval ACL
- audit closure
- panel-side access policy
- Worker package implementation

这意味着 04.5 冻结的是 runtime-boundary access policy，不是应用层身份治理完成。

## 非目标

- 不在本 phase 实现 Cloudflare Worker package
- 不在本 phase 实现 final end-user auth system
- 不在本 phase 定义最终 actor/group claim schema
- 不在本 phase 完成 retrieval ACL 或 audit/trace closure
- 不在本 phase 设计 panel-side 访问策略或内部业务流
- 不在本 phase 改动 `packages/*`
