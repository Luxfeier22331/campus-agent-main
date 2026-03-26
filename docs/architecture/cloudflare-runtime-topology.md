---
doc_type: architecture
status: active
created: 2026-03-25
updated: 2026-03-25
---

# Cloudflare Runtime Topology

## 文档边界

这份文档只冻结 Phase 04.2 的 Cloudflare-to-runtime topology，不负责实现部署、IaC 或 provider 配置，也不替代以下文档：

- public entry edge ownership：`docs/architecture/cloudflare-public-entry-boundary.md`
- protected panel trust model：`docs/architecture/protected-internal-panel-boundary.md`
- 长期 `apps/*` / `packages/*` 分层：`docs/architecture/long-term-architecture.md`
- supervisor runtime shell 与 core 分层：`docs/architecture/supervisor-architecture.md`
- 当前 04.2 planning/handoff：`.planning/phases/04.2-cloudflare-runtime-topology-and-delivery-shape-inserted/`

## 目标

Phase 04.2 在这里冻结的不是平台选型，而是 runtime topology：

- public hostname 如何落到 `apps/supervisor-api` runtime origin
- protected hostname 如何落到 separate protected panel runtime origin
- Cloudflare 与 repo-owned runtime 在 delivery 层分别拥有哪部分职责
- rollback unit 以哪个 surface/origin 为边界

## Topology Conclusion

系统的 runtime topology 固定为：

`client -> Cloudflare public surface -> public runtime origin -> apps/supervisor-api -> packages/supervisor-core -> specialist`

`authorized operator -> Cloudflare protected surface -> protected panel runtime origin -> future apps/* panel shell -> runtime APIs`

这里的关键结论是：

- public entry runtime origin 继续 anchored on `apps/supervisor-api`
- protected panel runtime origin 是 future `apps/` shell，不和 public entry 合并成一个 runtime boundary
- public 与 protected surface 即使未来共享某些托管基础设施，也不能因此合并成一个 exposure model、一个 hostname，或一个 rollback unit

## Surface-To-Origin Mapping

### Public entry surface

- Public reachability: yes
- Edge hostname: public answer hostname
- Runtime origin: `apps/supervisor-api`
- Runtime responsibility: transport ingress、runtime integration、supervisor-facing request mapping

### Protected panel surface

- Public reachability: no, protected only
- Edge hostname: dedicated protected hostname
- Runtime origin: future `apps/` panel shell
- Runtime responsibility: protected operator surface and runtime-API-only access path

## Topology And Ownership Matrix

| Surface | Hostname role | Reachability | Cloudflare owns | Repo-owned runtime origin | Rollback unit |
| --- | --- | --- | --- | --- | --- |
| Public entry | public answer hostname | Public | DNS/TLS, edge admission, hostname routing to origin | `apps/supervisor-api` | public entry surface and its origin mapping |
| Protected panel | protected operator hostname | Non-public by default | protected access envelope, hostname routing to protected origin | future `apps/` panel runtime shell | protected panel surface and its origin mapping |

## Delivery Ownership

### Cloudflare owns

- hostname exposure and edge route selection
- TLS termination and edge admission
- public/protected surface split
- protected surface outer protection envelope

### Repo-owned runtime owns

- origin process or service boundary under `apps/*`
- runtime-specific environment/config loading
- health/readiness behavior after origin selection
- transport semantics after a request reaches the runtime origin

### Core packages do not own

- hostname routing
- origin registration
- deployment secrets/config
- rollback orchestration

这些都不应进入 `packages/contracts`、`packages/supervisor-core`、`packages/rag-specialist`、`packages/retrieval-core` 或 `packages/ingestion-core`。

## Shared Substrate Rule

这份文档允许 public origin 与 protected origin 未来共享某些 hosting substrate，例如同一平台、同一 region、甚至同一 deployment family，但只在以下前提下成立：

- surface reachability 仍然分离
- runtime origin responsibility 仍然分离
- rollback 仍然能按 surface/origin 边界处理
- shared substrate 不变成合并 app boundary 的理由

也就是说，共享基础设施可以是部署实现细节，但不能推翻 two-surface runtime topology。

## Rollback Boundary

rollback unit 必须按 surface/origin 边界定义，而不是按整个 Cloudflare 层统一处理。

因此这里冻结：

- public entry 的变更应能按 public surface/origin 回滚
- protected panel 的变更应能按 protected surface/origin 回滚
- 任何 shared substrate 设计都不能让一条 surface 的回滚被迫隐式影响另一条 surface

## 与 Phase 5 的关系

这份文档只冻结 runtime topology，不关闭应用层治理。

仍然留给 Phase 5 的事项包括：

- `SupervisorRequest.actor`
- retrieval ACL
- audit / trace ownership
- 请求级身份与组信息传播

runtime topology 不能替代 Phase 5 的 actor、ACL 或 audit 闭环。

## 非目标

- 不在本 phase 实现 Cloudflare dashboard 配置、IaC、CI/CD 或容器编排
- 不在本 phase 选择最终 runtime/framework
- 不把 provider/runtime delivery 类型推入 `packages/*`
- 不定义 header forwarding、trace propagation、cache、timeout 或 streaming contract 细节
- 不设计 panel UI、panel business workflow 或 protected operator actions
