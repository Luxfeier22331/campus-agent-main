---
doc_type: architecture
owner_boundary: apps/campus-web
status: active
---

# 账号浏览器体验

## 边界

campus-web 负责账号 route shell、组件组合、中文文案、Turnstile 配置和安全 return target；账号、
身份、权限、偏好和联邦真相仍由 app-api Identity Platform 拥有。

## 当前页面

- `/account`
- `/account/login`
- `/account/register`
- `/account/forgot-password`
- `/account/reset-password`
- `/account/settings/account`
- `/account/settings/security`
- `/account/federation/consent`
- `/account/federation/error`

认证与设置 UI 使用仓库当前 Better Auth UI/HeroUI 组件。campus-web 只增加 route composition、
本地化、Turnstile、返回路径和注册法律同意字段，不维护第二套登录/注册/设置表单。

## 数据消费

认证动作通过明确 allowlist 的 `/api/auth/*` seam 调用 app-api。产品页面读取：

- `GET /api/me/overview`
- `GET /api/me/identity`
- `GET /api/me/access`
- `GET|PATCH /api/me/preferences`
- session 和 authorized-app command。

浏览器不得从 raw Better Auth payload 推导 campus identity、entitlement 或 memory truth。

## 登录连续性

- 未登录用户看到 login/register；
- 已登录用户看到账号摘要和允许的产品入口；
- restricted/operator surface 不作为普通首页卡片暴露；
- app availability 来自 app-api access projection，不在浏览器复制 policy。

## 所有权

campus-web 拥有：

- 校园与账号路由外壳；
- Better Auth 界面接线和本地化；
- 非持久注册法律确认；
- 浏览器返回目标校验；
- 应用导航展示。

campus-web 不拥有 auth DB、session store、principal mapping、verified identity、authorization、
profile memory、federation client registry、MediaWiki mapping 或 consent ledger。

## MediaWiki

`https://muc.wiki` 是 sibling service。campus-web 不提供内部 `/wiki`、不代理页面/上传、不读取
Wiki session，并且在联邦合同与部署验证完成前不得把登录联邦描述成可用。

## 相关文档

- `identity-platform.md`
- `mucwiki-login.md`
- `../../contracts/app-api/identity.md`
