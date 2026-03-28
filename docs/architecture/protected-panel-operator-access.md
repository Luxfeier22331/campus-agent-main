---
doc_type: architecture
status: active
created: 2026-03-27
updated: 2026-03-28
---

# Protected Panel Operator Access

## 文档边界

这份文档只冻结 protected panel 的 operator access 形态，不负责 panel UI、业务操作编排或 app-layer governance closure，也不替代以下文档：

- protected panel 的 trust boundary：`docs/architecture/protected-panel-boundary.md`
- protected panel 的 runtime shell：`docs/architecture/protected-panel-runtime-shell.md`
- shared app backend 与 web surfaces：`docs/architecture/shared-app-api-and-worker-web-surfaces.md`
- `app-api` runtime 与内部边界：`docs/architecture/app-api-architecture.md`
- public/protected surface 的 runtime topology：`docs/architecture/cloudflare-runtime-topology.md`
- supervisor runtime shell 与 core 分层：`docs/architecture/supervisor-architecture.md`

## 目标

这里冻结的是 protected panel 的长期 access model：

- panel 只面向受控 operator principal
- panel 不要求自建面向终端用户的完整账户产品
- upstream protected access 与 origin admission 必须同时成立
- operator-specific state 不因为性能优化而变成公共缓存对象
- panel 的产品形态固定为 operator control plane，而不是通用业务后台
- 首发 rollout 不默认包含全部长期功能域

## Access Model Conclusion

protected panel 的长期 access path 固定为：

`approved operator principal -> upstream protected access -> origin assertion validation -> minimal operator context -> panel runtime APIs`

关键结论是：

- 允许访问 panel 的主体是 operator principal，而不是开放注册用户
- upstream protected access 负责外层准入，不替代 origin admission
- panel app 只维护最小 operator context，不承担注册、密码恢复、资料管理或用户产品语义
- panel 的长期功能域固定为运行可见性、请求排障、任务观察、受控操作与审计，不扩张成任意后台
- 对于当前 2 到 3 人的小组使用场景，不需要额外自建 end-user user system

## Identity Source

panel 的长期身份来源固定为受控 upstream identity source，例如：

- Cloudflare Access 背后的企业邮箱域
- 企业 IdP group / claim
- 受控 machine principal

这条规则的含义是：

- 小团队使用不是省略身份边界的理由
- panel 不需要为了 2 到 3 个内部用户引入完整的 end-user account system
- access allowlist、group claim 和 machine principal 仍然属于长期有效的 operator access 方案

## Long-Term Functional Domains

protected panel 在长期上只承载以下五类功能域：

- `Overview`
  查看系统健康、最近错误、版本与关键运行摘要
- `Requests`
  通过 `request_id`、`conversation_id` 或相关标识查看请求级投影
- `Jobs`
  查看后台任务执行状态、失败摘要与重试历史
- `Operations`
  触发少量低频、可审计、可回滚的 operator 动作
- `Audit`
  查看 operator 行为记录、授权失败和关键系统动作投影

## Current Rollout Constraint

长期功能域不等于第一波产品范围。

当前默认 rollout 约束固定为：

- `Overview` 优先
- `Requests` 仅在 `apps/app-api` 提供安全 request projection query surface 后解锁
- `Jobs` 延迟，等待 scope 重开
- `Operations` 延迟，等待 scope 重开
- `Audit` 可以跟随可用的安全 projection surface 逐步引入，但不应通过原始日志旁路拼装

### Overview

允许：

- 系统健康与 readiness 摘要
- 最近错误概览
- 关键依赖状态
- 当前环境与版本投影

不允许：

- 直接浏览基础设施内部凭据或原始敏感配置

### Requests

允许：

- request-level 查询
- 按状态、时间和标识过滤
- 失败请求和 no-answer/clarification 摘要
- 查看经 runtime 治理后的 request projection，而不是原始运行日志

不允许：

- 将内部 package trace 原样暴露成未经治理的调试后门
- 直接把 audit log、telemetry sink 或 consumer app 会话表当作 request truth

### Jobs

允许：

- ingestion / rebuild / eval / smoke 等任务列表与详情
- 最近运行状态、失败原因和重试历史

不允许：

- 绕开 runtime API 直接操作队列、对象存储或索引内部状态

### Operations

允许：

- 少量明确、低频、受控的 operator 动作
- 例如重跑 smoke、触发受控 rebuild/sync、重试失败任务

不允许：

- 任意 shell、任意 SQL、任意内部 API 代理
- “万能运维控制台”式能力堆积

### Audit

允许：

- operator 动作记录
- 授权失败和敏感动作记录
- 与 request/job 标识关联的高层审计投影

不允许：

- 把审计页退化成无界限的原始日志浏览器

## Origin Admission

如果 protected surface 由 Cloudflare Access 保护，origin admission 最少必须满足：

- 校验 `Cf-Access-Jwt-Assertion` 或等价签名 access assertion
- 校验签名、issuer、audience 与过期时间
- 仅在断言有效时提取 operator identity claims
- 断言缺失、无效或不匹配时直接拒绝访问

origin admission 的职责是 protected runtime boundary 的一部分，不属于 `packages/*`。

## Minimal Operator Context

panel app 只需要最小 operator context，例如：

- operator identifier
- operator principal class
- 上游 identity source 投影出的最小 group / claim

长期上允许存在更细角色或审批流，但这些不要求 panel 先变成完整用户中心。

## Session Expectations

protected panel 的 session 假设固定为：

- session 由 upstream protected access 与 origin admission 共同约束
- session duration 应比公开用户面更短、更保守
- 敏感操作可以要求更强确认，但这属于后续业务/治理实现

## Cache And Response Posture

protected panel 的性能优化遵循以下边界：

- 指纹化静态资源可以作为受保护 surface 的静态交付对象处理
- HTML、JSON API、auth callback 与 operator-specific state 响应默认按 `no-store` / non-public cache posture 处理
- 性能优化优先来自 runtime API 聚合、分页、静态资源优化与独立缓存策略
- 不以性能为理由取消 surface split、origin admission 或 runtime-API-only seam

## Preferred Build Direction

panel 的长期构建方向优先是：

- `Cloudflare Workers` 作为 protected panel runtime
- 开源 admin framework 改造优先于完全自建 UI shell
- 当前首选是 `react-admin` 作为 UI 资源壳，再配合 custom pages 承载非 CRUD operator flows
- Worker 侧 BFF 推荐采用 `Hono`
- `Help Desk` demo 只作为视觉和信息架构参考
- UI 起步布局采用开源版默认 `<Layout>`

这条偏好只约束 panel 的长期 build direction，不改变 panel 只能调用受控 runtime APIs 的边界。

当前不作为主路线的选项：

- `ContainerLayout`
- `SolarLayout`
- `Appsmith`
- `ToolJet`

## Deferred

这份文档不关闭以下事项：

- app-layer actor mapping
- retrieval ACL
- audit / trace closure
- approval flow
- panel business workflows

这些仍然属于后续治理和业务实现范围。

## 非目标

- 不把 panel 改成自助注册产品
- 不把 operator access 推成 `packages/*` 内部 contract
- 不把 upstream protected access 误写成“已经完成授权”
- 不把缓存优化扩展成 trust boundary 重写
- 不把 panel 演化成通用 CMS、用户后台、数据库管理台或对象存储管理台
