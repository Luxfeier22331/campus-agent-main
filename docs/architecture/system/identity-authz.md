---
doc_type: architecture
owner_boundary: apps/app-api
status: active
---

# 身份与准入

## 边界

本文说明主问答链中的 account/session、operator access、quota/abuse 和 user-scoped memory
binding。校园身份平台模型见 `identity-platform.md`，个人记忆运行时见 `memory-plane.md`。

## 真相分层

- app-api：account、session、principal mapping、operator access、quota/abuse 和 memory binding；
- identity source/policy：校园身份验证和 entitlement；
- document/retrieval stack：机构知识、来源信任和 evidence；
- execution-control：消费最小 actor/authz projection 并执行 runtime tool admission；
- Hindsight：个人记忆内容与检索。

这些层不能互相授予权限。

## 准入

产品请求依次确认：

1. session 和 principal mapping；
2. account 状态；
3. quota/abuse posture；
4. protected ops surface 的 operator permission；
5. execution-control 的 tool/target admission；
6. 所属工具和来源 readiness。

当前普通 chat 用户共享同一组已开放 read-only tool，不按学生、教职工或院系建立隐式 tool
差异。未来若引入 restricted source 或 state-changing tool，必须增加明确产品和授权合同。

## 执行投影

app-api 只向 execution path 提供最小 typed actor/context/authz。execution-control 和 agent 不读取
raw JWT、Cookie、session row、profile table 或 MediaWiki identity。

retrieval 只执行已准入 target、source trust 和 evidence policy，不解析账号或记忆授权。

## Memory 边界

personal memory 可以影响：

- 会话追问；
- 偏好和措辞；
- 常用校区、地点、服务或别名消歧；
- 查询表述。

personal memory 不得决定 tool opening、source trust、fail-close、operator access、account/session
或 entitlement。

## 人机验证

Turnstile 等验证只加强 sign-in/sign-up/reset admission。成功结果不是 principal、identity、
memory、operator permission 或 tool opening；raw captcha token 和 provider risk signal 不进入执行、
检索或运维读模型。

## 外部 Wiki

MediaWiki 是 sibling service。不得共享 `.muc.wiki` Cookie、导入 password/session/user table，
或让执行链读取 Wiki 账号状态。联邦登录只通过 `mucwiki-login.md` 的显式协议实现。

## 禁止形态

- memory、偏好或聊天历史成为授权来源；
- raw auth/session 进入 agent 或 retrieval；
- Ops Web 绕过自身 Access admission 和应用 allowlist 解释权限；
- captcha/risk score 成为账号或工具真相；
- MediaWiki 本地账号成为 app identity truth。

## 相关文档

- `identity-platform.md`
- `identity-browser.md`
- `memory-plane.md`
- `tool-routing.md`
- `../../decisions/adr-0015-memory-boundaries.md`
