---
doc_type: architecture
status: active
created: 2026-03-25
updated: 2026-03-28
---

# Protected Panel Boundary

## 文档边界

这份文档只冻结 Phase 04.1 的 protected panel boundary，不负责定义具体 panel 功能，也不替代以下文档：

- public entry 与 Cloudflare edge ownership：`docs/architecture/cloudflare-public-entry-boundary.md`
- 长期 `apps/` 与 `packages/` 分层：`docs/architecture/long-term-architecture.md`
- shared app backend 与 web surfaces：`docs/architecture/shared-app-api-and-worker-web-surfaces.md`
- `app-api` runtime 与内部边界：`docs/architecture/app-api-architecture.md`
- protected panel operator access：`docs/architecture/protected-panel-operator-access.md`
- supervisor 请求边界：`docs/architecture/supervisor-architecture.md`
- 当前 phase handoff 与 deferred seams：`.planning/phases/04.1-cloudflare-entry-and-protected-internal-panel-design/04.1-PHASE5-HANDOFF.md`

## 目标

这里冻结的不是某个 panel 产品，而是一个 trust model：

- internal panel is non-public by default。
- internal panel 必须 default-deny / fail-closed。
- panel 使用独立 protected hostname/surface，并置于 Cloudflare-protected access 外层保护之下。
- panel 如果未来落地，属于 `apps/` runtime boundary；长期命名收口为 `apps/protected-panel-web`，不属于 `packages/supervisor-core`、`packages/contracts` 或 retrieval internals。
- panel 面向受控 operator principal，不要求自建面向终端用户的完整账号系统。

## 边界结论

future panel 的允许形态固定为：

`authorized operator principal -> Cloudflare-protected access -> panel app under apps/ -> apps/app-api -> runtime-owned query / execution seams`

这条链路里的硬约束是：

- panel 不是 public answer entry 的变体。
- panel may call runtime APIs only。
- panel 当前 canonical request read path 是 `apps/app-api`，而不是 `apps/supervisor-api`。
- panel must not bypass `apps/app-api` 或其他受控 runtime boundary 直接触达 `packages/*`。
- panel 必须保持 non-public by default；任何失去上层保护条件的场景都应 fail-closed。
- 外层 protected access 命中后，origin 仍需校验签名访问断言，而不是把 upstream allow 当作最终授权完成。

## Allowed Access Preconditions

允许访问 panel 的前置条件必须同时满足：

- 请求经过 Cloudflare-protected access，而不是直接公开暴露。
- 请求主体属于预先批准的 principal classes。
- 访问目标是 separate protected hostname/surface，而不是 public answer hostname。
- 外层保护或策略判定异常时，panel 不降级为匿名可达，而是直接拒绝访问。
- panel origin 必须校验 `Cf-Access-Jwt-Assertion` 或等价的签名 access assertion；断言缺失、无效、受众不匹配或 issuer 不匹配时直接拒绝访问。

## Operator Access Model

panel 的 identity model 在长期上固定为 controlled operator access，而不是自助式 end-user account product：

- 默认依赖上游受控 identity source，例如 Cloudflare Access 背后的企业邮箱、IdP group 或 machine principal。
- panel 本身不要求注册、找回密码、用户资料维护、开放邀请等终端用户账号能力。
- 应用层只需要最小 operator principal 映射与授权判断，不把“小团队使用”解释成可以省略身份与授权。

## Principal Classes

当前阶段只冻结 principal class 边界，不冻结最终身份实现：

- human operator
  校内运维、支持或内容运营人员，用于受控查看内部状态或触发受保护操作。
- engineering maintainer
  负责运行时维护、调试和发布验证的工程人员。
- automation principal
  后续如需加入自动化 panel-side job，只能作为受控 machine principal 进入，不能假装成普通公网调用方。

是否存在更细粒度角色、group claim、审批流程或分级授权，全部 deferred to Phase 5；但这不改变“panel 不需要完整 end-user account system”的长期方向。

## Allowed Runtime Path

panel 的允许交互路径固定如下：

`panel -> runtime APIs only -> shared app-api -> apps/* runtime shell -> packages/* through existing runtime-owned seams`

具体约束：

- panel 自身如果实现，放在 `apps/` 下，而不是合并进 `apps/supervisor-api`。
- panel 的 forward web-surface 名称固定为 `apps/protected-panel-web`。
- panel 只能消费 runtime APIs，不能 import `packages/supervisor-core`、`packages/contracts`、`packages/rag-specialist` 或 retrieval internals 作为直连后门。
- panel 发起的任何请求都 must not bypass shared `app-api` boundary。
- panel 发起 request visibility 查询时，不得把 `apps/supervisor-api` 当作列表/详情读取面。
- panel 不承担 auth/session/conversation backend；这些进入 shared `apps/app-api`。
- panel 不得把 consumer chat conversation store、raw audit logs 或 telemetry sinks 当作 canonical request truth。
- 如果需要读写内部能力，必须通过受控 runtime API surface，而不是把 package internals 暴露给前端或 panel server。
- panel runtime 不把 Cloudflare Access identity header 直接当成业务授权结论；origin admission 与 app-layer authorization 仍然是 repo-owned runtime concern。

## 与 Public Entry 的关系

internal panel 与 public entry 的关系固定为并列双表面，而不是同一路径上的权限分支：

- public entry 负责对外问答入口。
- protected panel 负责内部受保护操作面。
- 两者共享上层 Cloudflare 平台能力，但不共享 reachability、hostname 或默认信任假设。

这条规则的目的，是避免 panel 变成 public entry 上的一组隐藏管理员参数或未公开路由。

## 对核心 package 的限制

Phase 04.1 不授权以下变化：

- 不修改 `packages/contracts` 来承载 panel-specific transport identity。
- 不把 panel 逻辑塞进 `packages/supervisor-core`。
- 不让 `packages/rag-specialist` 或 `packages/retrieval-core` 暴露 panel-only 入口。
- 不因为 panel 需求而新增绕过 runtime APIs 的内部调用路径。

## Phase 5 Deferred

这份文档明确只记录 boundary-level identity and authorization requirements，不在这里关闭应用层治理问题。

仍留给 Phase 5 的事项包括：

- `SupervisorRequest.actor` 的映射规则。
- retrieval-time ACL 过滤。
- audit / trace 的完整闭环。
- panel-side business workflow、写入动作和审批路径。

Cloudflare-protected access 是 outer protection envelope，不等于应用层授权完成；小团队 operator panel 仍然需要 origin admission、最小授权和审计语义。

## 非目标

- 不在本 phase 设计具体 panel 页面、业务流或写操作。
- 不在本 phase 确定 runtime/framework 细节。
- 不把 panel 合并成 `apps/supervisor-api` 的隐藏管理模式。
- 不改变 `packages/supervisor-core`、`packages/contracts` 或 retrieval 相关 package 的长期职责。
- 不把“只有 2 到 3 个内部用户”解释成可以省略身份边界或把 panel 退化成无控制的管理入口。
