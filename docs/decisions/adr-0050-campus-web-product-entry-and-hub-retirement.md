---
doc_type: decision
truth_scope: repository
owner_boundary: docs/decisions
decision_id: ADR-0050
status: accepted
created: 2026-06-09
updated: 2026-06-09
---
# ADR-0050 Campus Web Product Entry And Hub Retirement

## 状态

Accepted on 2026-06-09.

## 背景

本分支引入 `apps/campus-web` 后，学生侧体验已经不再是一个独立 launcher 后面挂多个
surface 的模型。账号浏览器 shell、学生侧应用入口、问答、文档、地图、食堂与反馈应收敛在同一个
campus product origin 下。

继续把 `hub-web` 写成 product entry、account shell、auth return target 或 OAuth issuer 会让
代码、文档、staging smoke 和未来 MediaWiki OIDC 配置全部朝错误方向漂移。

## 决策

### 决策 1：`campus-web` 是学生侧 product entry

Production public endpoint 固定为：

```text
https://campus.muc.wiki
```

Staging browser endpoint 固定为：

```text
https://campus-staging.mucwiki-edge.link
```

`apps/campus-web` 拥有学生侧 browser shell：

- `/`
- `/c/:conversationId`
- `/docs/*`
- `/map`
- `/dining`
- `/feedback`
- `/account/*`

### 决策 2：`campus-web` 接管 account browser shell

`campus-web` owns browser UX for:

- `/account`
- `/account/login`
- `/account/register`
- `/account/forgot-password`
- `/account/reset-password`
- `/account/federation/consent`
- `/account/federation/error`

`apps/app-api` 仍然拥有 auth/session/identity/federation provider truth。`campus-web`
只拥有 browser composition、same-origin proxy seam、auth form UX 和 return-target validation。

### 决策 3：OAuth/OIDC issuer 跟随 campus product endpoint

Production issuer 固定为：

```text
https://campus.muc.wiki
```

Staging issuer 固定为：

```text
https://campus-staging.mucwiki-edge.link
```

Canonical federation endpoints 保持：

```text
/.well-known/openid-configuration
/.well-known/oauth-authorization-server
/api/federation/authorize
/api/federation/token
/api/federation/userinfo
/api/federation/jwks
/api/federation/logout
```

Endpoint implementation owner 仍是 `apps/app-api`。

### 决策 4：`hub-web` 退出 active path

`apps/hub-web` 不再是：

- product entry
- account shell
- auth return target
- OAuth/OIDC issuer origin
- staging deploy gate
- identity/account browser smoke target

第一批保留 package 作为 retired implementation artifact；第二批在确认无 route、secret、
deploy 依赖后删除 package。

## 结果

- 当前产品入口、账号浏览器 shell 与 OAuth/OIDC public issuer 统一到 `campus.muc.wiki`。
- `return_app=campus` 与跨 shell hub return target 不再是当前架构的一部分。
- 旧 chat-local auth routes 如需兼容，只能重定向到 `AUTH_SHELL_ORIGIN`
  指向的 campus account shell；不得重新引入 `HUB_WEB_BASE_URL`。
- 新增或修改 active docs/runbooks/tests 时，不得把 `hub-web` 描述成 current/future product
  entry 或 account shell。

## 相关文档

- `docs/architecture/current.md`
- `docs/architecture/system/product-runtime-architecture.md`
- `docs/architecture/system/identity-browser-experience-architecture.md`
- `docs/architecture/system/identity-platform-architecture.md`
- `docs/architecture/system/federation-and-mucwiki-login-architecture.md`
- `docs/contracts/app-api-federation-http.md`
- `docs/contracts/app-api-identity-platform-http.md`
