---
doc_type: architecture
status: active
created: 2026-03-25
updated: 2026-03-29
---

# Protected Panel Runtime Shell

## 文档边界

这份文档只冻结 Phase 04.4 的 protected panel runtime shell，不负责 panel UI、business workflow 或治理闭环，也不替代以下文档：

- protected panel 的 trust boundary：`docs/architecture/protected-panel-boundary.md`
- protected panel 的 operator access：`docs/architecture/protected-panel-operator-access.md`
- public/protected surface 的 runtime topology：`docs/architecture/cloudflare-runtime-topology.md`
- shared app backend 与 web surfaces：`docs/architecture/shared-app-api-and-worker-web-surfaces.md`
- `app-api` runtime 与内部边界：`docs/architecture/app-api-architecture.md`
- `official_web` control-plane architecture：`docs/architecture/official-web-control-plane-on-app-api.md`
- 长期 `apps/*` / `packages/*` 分层：`docs/architecture/long-term-architecture.md`
- request projection 与 runtime-owned read model：`docs/architecture/request-projection-and-runtime-read-model.md`
- supervisor runtime shell 与 core 分层：`docs/architecture/supervisor-architecture.md`

## 目标

Phase 04.4 在这里冻结的是 protected panel 作为 repo/runtime shape 的定义：

- 它属于 `apps/` 下的独立 runtime shell
- 它只允许通过 runtime APIs 与系统交互
- 它必须保持 fail-closed
- 它不承担 UI/business/governance scope
- 它承载受控 operator access 的 runtime admission，但不扩张成完整用户系统
- 它的正式 runtime 形态冻结为 `Cloudflare Workers`

## Runtime Shell Conclusion

protected panel 的 shell 形态固定为：

`protected panel surface -> Cloudflare Worker panel shell -> apps/app-api (Worker) -> request projection / official_web operator read models`

关键结论是：

- panel 不是 `apps/supervisor-api` 的隐藏管理模式
- panel 不是 `packages/*` 的直连消费方
- panel runtime shell 的责任是承载 protected operator surface，而不是重写 supervisor 或 retrieval 语义
- panel runtime shell 的技术形态接受 `Cloudflare Workers + static assets + panel BFF`
- panel shell 位于 shared `apps/app-api` 之上，而不是自己承载 request projection 或产品后端语义

## Repo Shape

panel 如果后续落地，repo shape 固定为：

- lives under `apps/`
- remains separate from `apps/supervisor-api`
- consumes runtime APIs only
- is deployed as a Cloudflare Worker boundary for the protected panel surface

这意味着 panel shell 是 runtime boundary，而不是业务能力边界。

## UI Shell Shape

panel 的 UI 壳在长期上允许优先采用开源 admin framework 改造，但必须保持 app boundary 不变：

- 优先接受 `react-admin` 作为 panel UI shell
- 起步布局采用开源版默认 `<Layout>`
- `Help Desk` demo 只作为信息架构与视觉方向参考
- 允许在 `react-admin` 之上添加 custom pages 来承载非 CRUD 的 operator flows
- UI framework 不得反向定义 panel 的 runtime seam、auth model 或 package boundary

这里冻结的是 “UI 壳可以复用成熟开源 admin framework”，而不是把 panel 扩张成通用后台平台。

当前不作为默认起步方向的选项：

- `ContainerLayout`
- `SolarLayout`
- `Appsmith`
- `ToolJet`

## Allowed Runtime API Seam

allowed seam 只允许：

`panel -> Worker-local BFF -> shared app-api runtime APIs`

因此这里冻结：

- panel 只能消费 runtime-facing APIs
- panel 当前 request visibility 的 canonical seam 是 `panel shell -> apps/app-api`
- panel 当前 `Official Web` visibility 的 canonical seam 也是 `panel shell -> apps/app-api`
- panel 不得直接 import `packages/contracts`
- panel 不得直接 import `packages/supervisor-core`
- panel 不得直接 import `packages/rag-specialist`、`packages/retrieval-core` 或其他 package internals

## Operator Admission Responsibilities

protected panel runtime shell 如果后续落地，最小 runtime responsibility 固定为：

- 验证 `Cf-Access-Jwt-Assertion` 或等价签名 access assertion，拒绝缺失、无效或 audience/issuer 不匹配的请求
- 从上游受控 identity source 提取最小 operator context，而不是维护面向终端用户的完整账户产品
- 仅在 admission 成立后调用 runtime APIs
- 为后续 app-layer audit / trace 留出稳定的 runtime seam
- 为 panel UI 提供 Worker-local BFF / aggregation seam，而不是把前端直接接到内部 runtime surfaces

这意味着 panel shell 负责 protected operator surface 的请求准入，但不因此拥有 actor、ACL、approval 或完整治理语义。

## BFF Shape

panel 的 Worker-local BFF 在长期上推荐采用 `Hono`：

- 负责 Worker 路由与 middleware 组织
- 承载 Access assertion validation 与 operator admission middleware
- 暴露 panel-facing `/api/*` aggregation routes
- 不改变 panel 只调用受控 runtime APIs 的基础边界

对 `Requests` domain 的额外约束：

- BFF 只能调用 runtime-owned request projection APIs
- BFF 当前默认对接 `apps/app-api` 的 operator query surface，而不是 `apps/supervisor-api`
- BFF 不得读取 consumer app conversation store、audit log 或 telemetry sink 来拼 list/detail

对 `Official Web` domain 的额外约束：

- BFF 只能调用 `apps/app-api` 的 official_web site/run/detail APIs
- BFF 不得扫描对象存储目录、队列、Qdrant 或 ingestion worker 状态来拼页面

## Forbidden Coupling

以下耦合在 04.4 明确禁止：

- 把 panel 做成 `apps/supervisor-api` hidden admin mode
- 让 panel 直接依赖 `packages/*`
- 让 panel 越过 runtime API seam 直连内部 orchestrator 或 retrieval internals
- 让 panel 把 `apps/supervisor-api` 当作 request list/detail query backend
- 让 panel 把 raw audit logs、telemetry sink 或 consumer chat store 当作 request 主数据源
- 让 panel runtime shell 承担 app-layer actor、ACL、audit 或 approval semantics

## Fail-Closed Runtime Assumptions

protected panel 的 runtime shell 必须保持 fail-closed：

- protection or routing assumptions 丢失时，应转为不可访问
- runtime shell 不能降级成 public reachable surface
- fail-closed posture 属于 runtime/delivery assumption，而不是 package concern
- operator admission 前置条件不成立时，shell 必须在 origin 侧 fail closed，而不是信任上游网络位置或未校验 header

## Session And Cache Assumptions

protected panel 的性能优化不能以破坏 trust boundary 为代价：

- 优先优化 panel shell 对 runtime APIs 的聚合方式，而不是放宽 `runtime APIs only`
- 指纹化静态资源可以作为受保护 surface 的静态交付对象处理
- HTML、JSON API、auth callback 与任何带 operator-specific state 的响应默认按 `no-store` / non-public cache posture 处理
- cache 或静态托管优化不是把 protected panel 并回 public entry 的理由

## Long-Term Capability Envelope

panel runtime shell 在长期上只承载 operator control plane 所需的最小能力域：

- `Overview`
  系统健康、最近错误、关键依赖与运行摘要
- `Requests`
  以 `request_id`、`conversation_id` 或相关标识查看由 shared `app-api` 产出的 runtime-owned request projection 与失败投影
- `Official Web`
  查看站点、crawl runs、run detail、failures 与 artifacts 摘要；数据源固定为 shared `app-api` 的 official_web control-plane APIs
- `Jobs` / `Operations` / `Audit`
  仍属于可选后续域，不默认进入第一波 rollout

这些能力域都是 panel shell 之上的产品组织，不改变 “Worker shell + runtime APIs only” 的基础边界。

当前第一波 rollout 的默认范围不是这五个域全部同时实现：

- `Overview` 是默认起步域
- `Requests` 已随着 `apps/app-api` 的安全 query surface 落地而解锁
- `Official Web` 已随着 `app-api` official_web control-plane APIs 与 panel domain 一起落地
- `Jobs`、`Operations` 与 `Audit` 当前保持 delayed，直到产品 scope 被明确重开

## 与 UI / Business / Governance 的关系

这份文档明确把三类东西排除在 shell phase 之外：

- UI
  panel 页面、路由、交互层结构
- business workflow
  panel-side business action、写操作、运营流程
- governance
  actor mapping、retrieval ACL、audit/trace closure、approval flow

这些都不由 04.4 关闭。

## 与 Phase 5 的关系

Phase 04.4 不解决：

- `SupervisorRequest.actor`
- retrieval ACL
- audit / trace closure
- approval flow

这些仍然属于 Phase 5 或更后的治理阶段。

## 非目标

- 不在本 phase 设计 panel UI / routes / pages
- 不在本 phase 设计 panel business actions
- 不在本 phase 实现 auth/identity mapping
- 不在本 phase 修改 `packages/*` contract 或职责
- 不把 panel shell 扩张成自助注册、密码找回或用户资料管理系统
- 不把 panel shell 扩张成 CMS、数据库控制台、对象存储控制台或任意命令执行台
- 不把 `Official Web` 扩张成对象存储浏览器、队列浏览器、Qdrant 控制台或 crawler debug shell
- 不把第三方 UI 模板或 low-code 平台引入为主导架构，而让它们反向决定 runtime seam
