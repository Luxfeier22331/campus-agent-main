---
doc_type: architecture
status: active
created: 2026-03-25
updated: 2026-03-25
---

# Protected Panel Runtime Shell

## 文档边界

这份文档只冻结 Phase 04.4 的 protected panel runtime shell，不负责 panel UI、business workflow 或治理闭环，也不替代以下文档：

- protected panel 的 trust boundary：`docs/architecture/protected-internal-panel-boundary.md`
- public/protected surface 的 runtime topology：`docs/architecture/cloudflare-runtime-topology.md`
- 长期 `apps/*` / `packages/*` 分层：`docs/architecture/long-term-architecture.md`
- supervisor runtime shell 与 core 分层：`docs/architecture/supervisor-architecture.md`

## 目标

Phase 04.4 在这里冻结的是 protected panel 作为 repo/runtime shape 的定义：

- 它属于 future `apps/` runtime shell
- 它只允许通过 runtime APIs 与系统交互
- 它必须保持 fail-closed
- 它不承担 UI/business/governance scope

## Runtime Shell Conclusion

protected panel 的 shell 形态固定为：

`protected panel surface -> future apps/* panel shell -> runtime APIs`

关键结论是：

- panel 不是 `apps/supervisor-api` 的隐藏管理模式
- panel 不是 `packages/*` 的直连消费方
- panel runtime shell 的责任是承载 protected operator surface，而不是重写 supervisor 或 retrieval 语义

## Repo Shape

panel 如果后续落地，repo shape 固定为：

- lives under `apps/`
- remains separate from `apps/supervisor-api`
- consumes runtime APIs only

这意味着 panel shell 是 runtime boundary，而不是业务能力边界。

## Allowed Runtime API Seam

allowed seam 只允许：

`panel -> runtime APIs only`

因此这里冻结：

- panel 只能消费 runtime-facing APIs
- panel 不得直接 import `packages/contracts`
- panel 不得直接 import `packages/supervisor-core`
- panel 不得直接 import `packages/rag-specialist`、`packages/retrieval-core` 或其他 package internals

## Forbidden Coupling

以下耦合在 04.4 明确禁止：

- 把 panel 做成 `apps/supervisor-api` hidden admin mode
- 让 panel 直接依赖 `packages/*`
- 让 panel 越过 runtime API seam 直连内部 orchestrator 或 retrieval internals
- 让 panel runtime shell 承担 app-layer actor、ACL、audit 或 approval semantics

## Fail-Closed Runtime Assumptions

protected panel 的 runtime shell 必须保持 fail-closed：

- protection or routing assumptions 丢失时，应转为不可访问
- runtime shell 不能降级成 public reachable surface
- fail-closed posture 属于 runtime/delivery assumption，而不是 package concern

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
