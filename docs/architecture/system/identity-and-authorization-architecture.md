---
doc_type: architecture
status: active
created: 2026-04-02
updated: 2026-05-02
---
# Account, Operator Access, And Memory Binding Architecture

## 文档边界

本文冻结主问答产品路径上的 account / session、operator access、quota / abuse control 与
user-scoped memory binding supporting architecture。

它回答的是：

- 哪些 truth layer 存在
- 它们分别属于谁
- execution / retrieval path 只能消费什么投影
- memory 为什么不是 policy / opening truth

本文不把 restricted documents、学生 / 教职工差异化 capability 权限、approval / HITL 或
state-changing tools 作为当前主问答产品目标。若历史 ADR 提到这些主题，应按历史决策或非目标分支阅读，不得反向影响当前
Campus Assistant 主链路。

## Canonical Truth Layers

长期主问答真相固定拆成：

- `account / session`
- `operator access`
- `quota / abuse control`
- `user-scoped memory binding`
- `institutional knowledge`

其中：

- account / session、operator access、quota / abuse control 与 user-scoped memory
  binding 由 `apps/app-api` 拥有 canonical product truth
- `institutional knowledge` 由 document / retrieval / evidence stack 拥有 canonical
  truth

## Accepted Ownership Posture

account / operator / memory supporting architecture 当前已经明确：

- `apps/app-api` 是唯一 product-layer auth / session / principal owner
- `apps/hub-web` 只拥有 account browser shell；它不拥有 auth database、session
  storage、principal mapping、operator access 或 quota truth
- execution path 只消费 typed actor/context projection
- retrieval path 只消费 admitted source / runtime profile / evidence policy，不拥有
  account、operator access 或 memory binding truth
- personal memory 存在，但只是 per-user advisory context；它不是 account、operator
  access、source truth、capability opening 或 fail-close truth

## Ownership Model

### `apps/app-api`

- product-layer auth / session / principal mapping
- account / session truth
- operator access truth
- quota / abuse-control truth
- user-scoped memory binding truth

### execution path

- 只消费 typed projection
- 不直接解析 raw JWT、raw session、raw memory、raw transcript

### retrieval path

- 只执行 admitted retrieval / source-trust / runtime profile constraints
- 不拥有 account / operator / memory binding resolution
- 不把 memory 当成授权来源

## Product Admission Model

主问答 admission 至少覆盖：

- principal mapping
- account / session validity
- quota / abuse-control posture
- operator surface access when caller is using protected ops APIs
- surface capability allowlist
- capability readiness / opening posture

普通 chat 用户默认共享同一组成熟 read-only campus capabilities。当前主问答架构不设计学生 /
教职工 / 院系之间的 capability 权限差异。

## Memory Vs Applicability

personal memory 只能作为 applicability / context signal：

- follow-up continuity
- user preference / wording preference
- common campus, alias, service, route, or topic disambiguation
- query framing hints

personal memory 不能决定：

- capability 是否开放
- tool 是否 allowed
- source trust 是否放宽
- fail-close 是否绕过
- operator / panel access
- account / session truth

## Projection To Execution

execution path 的长期规则：

- `apps/app-api` 提供最小 typed actor/context
- `apps/execution-control` 只做 caller admission，不恢复最终业务 actor
- Execution Agent Layer / agent 基于 typed projection 做 planning、clarification、wording

## Operator Access

operator access 属于 protected ops surface 的 product truth；protected surface 的 runtime
shell 仍由 `docs/architecture/system/product-runtime-architecture.md` 负责。

这里的硬约束只有：

- upstream protected access 不等于最终授权完成
- minimal operator context 仍来自 app-owned truth
- panel 不自建 end-user account product

## Human Verification And Auth Admission

Turnstile 这类 human verification 属于 auth admission hardening，不属于 canonical
account / session truth。

边界固定为：

- verification 失败只代表 auth-family request 在 admission 处 fail-close
- verification 成功也不会变成 principal、profile、memory binding、operator access 或
  capability opening truth
- interactive challenge escalation 属于 product runtime / edge provider
  posture，不下沉到 Execution Agent Layer、retrieval 或 panel
- raw captcha token、provider-specific risk signal 与 challenge state 不进入
  execution path、retrieval path 或 operator read model

## Legacy MediaWiki Identity Compatibility

既有 `muc.wiki` MediaWiki 继续作为 sibling legacy service 运营。

当前 compatibility posture 固定为 `external_link_only`：

- hub 只暴露 external legacy card 到 `https://muc.wiki`
- `/wiki` 不是 hub internal slug
- 不迁移 MediaWiki 用户、页面内容或上传媒体
- 不把 MediaWiki cookie、session、user table 或 password hash 导入 `apps/app-api`
- 不让 Execution Agent Layer、agent、retrieval 或 operator panel 读取 MediaWiki
  account/session state
- 不设置 `.muc.wiki` 共享 auth cookie；new app-set auth cookie scope 保持在 hub/app
  browser shell 的 origin 语义内，并由 app-api / Better Auth 负责 server-side truth

如果未来要做 legacy login federation，只能通过显式 federation protocol / MediaWiki auth
extension 进入新的 workstream；不得把本地 MediaWiki session 复用当成捷径。

## Forbidden Shapes

- 不把 memory 提升成授权来源
- 不把 raw JWT / raw session 洩漏给 Execution Agent Layer / agent / retrieval
- 不把 MediaWiki cookie / session / password hash 提升为 app identity truth
- 不把 captcha token / challenge state / risk score 提升成 account、operator access 或
  capability-opening truth
- 不让 operator panel 旁路 `app-api` 直接做授权解释
- 不把 personal memory 当作 source truth、capability opening truth 或 fail-close override

## 相关稳定文档

- `docs/architecture/product-positioning.md`
- `docs/architecture/system/capability-routing-and-admission-architecture.md`
- `docs/architecture/system/memory-plane-architecture.md`
- `docs/decisions/adr-0015-user-identity-memory-and-personalization-boundaries.m
  d`
- `docs/decisions/adr-0049-qdrant-native-personal-memory-index.md`
