---
doc_type: decision
owner_boundary: docs/decisions
decision_id: ADR-0045
status: accepted
---
# ADR-0045 身份平台

## 背景

credential/session library table 是有用的运行状态，但把它直接作为产品账户模型会让每个
浏览器和 relying party 绑定 Better Auth 内部结构。

## 决策

`apps/app-api` 拥有产品 identity。Better Auth 是当前 credential、session 和 federation
runtime adapter，不定义公开 account、identity、access、preference 或 federation contract。

应用拥有的 `identity.*` table 和 `/api/me/*` projection 分别表达：

- account lifecycle；
- verified institutional identity；
- access snapshot；
- user preference；
- relying-party federation policy。

Campus Web 只拥有 account 和 consent UI，消费 app-api projection，不读取 auth/identity
table。execution-control 只接收有界 principal 和 authorization projection，不接收 raw
cookie、session 或 Better Auth record。

federation 使用明确 OAuth/OIDC protocol endpoint 和受控 client registry。MediaWiki 等
sibling service 是 relying party，并拥有本地 account linkage；不得共享 session、cookie
或 password hash。

memory 和 preference 可以影响用户体验或 query wording，但不能授权、开放 tool 或改变
evidence visibility。

## 后果

- Better Auth 可以在版本化产品合同后升级或替换。
- authentication 本身不证明 verified campus identity。
- operator/service principal 不成为普通 end-user account。
- 即使 Better Auth 执行 protocol mechanics，federation client policy 仍由应用拥有。

## 相关文档

- `docs/architecture/system/identity-platform.md`
- `docs/architecture/system/identity-authz.md`
- `docs/contracts/app-api/identity.md`
- `docs/data/identity-platform.md`
