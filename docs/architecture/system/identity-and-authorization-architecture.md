---
doc_type: architecture
status: active
created: 2026-04-02
updated: 2026-06-09
---
# Identity And Authorization Architecture

## 文档边界

本文冻结 canonical identity、authorization、memory 与 retrieval filter projection 的
supporting architecture。

它回答的是：

- 哪些 truth layer 存在
- 它们分别属于谁
- execution / retrieval path 只能消费什么投影

## Canonical Truth Layers

长期真相固定拆成：

- `verified identity`
- `profile memory`
- `session memory`
- `authorization truth`
- `institutional knowledge`

其中：

- 前四层由 `apps/app-api` 拥有 canonical truth
- `institutional knowledge` 由 document / retrieval / evidence stack 拥有 canonical
  truth

## Accepted Ownership Posture

identity / authz / memory supporting architecture 当前已经明确：

- `apps/app-api` 是唯一 product-layer auth / session / principal owner
- `apps/campus-web` 只拥有 account browser shell；它不拥有 auth database、session
  storage、principal mapping 或 authorization truth
- execution path 只消费 typed actor/context projection
- retrieval path 只消费 authz projection carrier，不拥有最终 entitlement resolution

当前仍存在、但 owner 已明确的后续工作包括：

- restricted document rollout
- memory / personalization productization
- legacy ACL carrier sunset

这些是后续 productization / rollout gap，不应倒推为“authz truth 尚未归属”，也不应把旧 foundation plan
直接当成当前 merged truth。

补充说明：

- identity / restricted foundation 本身已在 Phase 11 收口
- 当前若继续推进这条域，默认应把 rollout / sunset 看作 deferred follow-up，而不是重新打开 foundation
  ownership 讨论
- 当前 active/deferred lifecycle 与 pending work 统一看 `docs/domains/identity-authz-m
  emory.md`、`.planning/PROJECT.md`、`.planning/WORKSTREAMS.md` 与对应 workstream
  `STATE.md`

## Ownership Model

### `apps/app-api`

- product-layer auth / session / principal mapping
- verified identity
- profile memory
- session memory
- canonical authorization truth

### execution path

- 只消费 typed projection
- 不直接解析 raw JWT、raw session、raw memory、raw transcript

### retrieval path

- 执行 authz filter projection
- 不拥有最终 entitlement resolution
- 不把 memory 当成授权来源

## Authorization Model

authorization truth 至少覆盖：

- principal mapping
- entitlement truth
- resource ownership truth
- approval truth

当前 retrieval-side ACL metadata 只是 transitional projection carrier，不是 canonical
authz schema。

## Visibility Vs Applicability

- `visibility` 决定是否可见
- `applicability` / personalization 决定如何优先、如何措辞、是否需要 clarification

例如：

- major / cohort / program / recent goal 默认首先属于 applicability / personalization
- 它们不能被静默提升成可见性授权

## Projection To Execution

execution path 的长期规则：

- `apps/app-api` 提供最小 typed actor/context
- `apps/execution-control` 只做 caller admission，不恢复最终业务 actor
- supervisor / agent 基于 typed projection 做 planning、clarification、wording

## Restricted Documents And Retrieval

当前 restricted document rollout 已转为 deferred follow-up，但长期形态已明确：

- canonical authz truth 在 `app-api`
- retrieval 只消费显式 authz projection
- memory 不能授予 restricted visibility
- restricted resource family 不能靠 prompt-only 软约束实现

当前如果 restricted rollout 尚未完成，也只能表现为“能力未上线”或 fail-close；不能反向把 authz 解释权交给
retrieval、prompt 或 panel。

## Operator Access

operator access 也属于 authz truth 的一部分，但 protected surface 的 runtime shell 仍由
`docs/architecture/system/product-runtime-architecture.md` 负责。

这里的硬约束只有：

- upstream protected access 不等于最终授权完成
- minimal operator context 仍来自 app-owned truth
- panel 不自建 end-user account product

## Human Verification And Auth Admission

Turnstile 这类 human verification 属于 auth admission hardening，不属于 canonical
identity / authz truth。

边界固定为：

- verification 失败只代表 auth-family request 在 admission 处 fail-close
- verification 成功也不会变成 principal、profile、entitlement 或 retrieval visibility
  truth
- interactive challenge escalation 属于 product runtime / edge provider
  posture，不下沉到 supervisor、retrieval 或 panel
- raw captcha token、provider-specific risk signal 与 challenge state 不进入
  execution path、retrieval path 或 operator read model

## Legacy MediaWiki Identity Compatibility

既有 `muc.wiki` MediaWiki 继续作为 sibling legacy service 运营。

当前 compatibility posture 固定为 `external_link_only`：

- hub 只暴露 external legacy card 到 `https://muc.wiki`
- `/wiki` 不是 hub internal slug
- 不迁移 MediaWiki 用户、页面内容或上传媒体
- 不把 MediaWiki cookie、session、user table 或 password hash 导入 `apps/app-api`
- 不让 supervisor、agent、retrieval 或 operator panel 读取 MediaWiki identity state
- 不设置 `.muc.wiki` 共享 auth cookie；new app-set auth cookie scope 保持在 hub/app
  browser shell 的 origin 语义内，并由 app-api / Better Auth 负责 server-side truth

如果未来要做 legacy login federation，只能通过显式 federation protocol / MediaWiki auth
extension 进入新的 workstream；不得把本地 MediaWiki session 复用当成捷径。

## Forbidden Shapes

- 不把 memory 提升成授权来源
- 不把 raw JWT / raw session 洩漏给 supervisor / agent / retrieval
- 不把 MediaWiki cookie / session / password hash 提升为 app identity truth
- 不把 captcha token / challenge state / risk score 提升成 identity 或 authorization
  truth
- 不把 retrieval payload ACL 字段误读成 canonical authz truth
- 不让 operator panel 旁路 `app-api` 直接做授权解释

## 相关稳定文档

- `docs/domains/identity-authz-memory.md`
- `docs/decisions/adr-0015-user-identity-memory-and-personalization-boundaries.m
  d`
- `docs/decisions/adr-0022-campus-identity-and-restricted-document-authorization
  .md`
