---
doc_type: architecture
status: active
created: 2026-03-26
updated: 2026-03-26
---

# Public Consumer Chat Surface

## 文档边界

这份文档只冻结 public consumer chat surface 的第一版产品形态与 repo 边界，不替代以下文档：

- public entry edge/control boundary：`docs/architecture/cloudflare-public-entry-boundary.md`
- public entry 到 runtime origin 的 forwarding contract：`docs/architecture/cloudflare-public-entry-integration-contract.md`
- Worker-only consumer-entry 与 access posture：`docs/architecture/cloudflare-worker-consumer-entry-access-policy.md`
- 长期 `apps/*` / `packages/*` 分层：`docs/architecture/long-term-architecture.md`
- supervisor runtime shell 与 core 分层：`docs/architecture/supervisor-architecture.md`
- public consumer chat 用户系统与数据边界：`docs/architecture/public-consumer-chat-auth-and-data-boundary.md`
- public consumer chat 前台宿主决策：`docs/decisions/adr-0009-public-consumer-frontend-host.md`

这份文档也不负责冻结 Phase 5 actor/ACL/audit 语义，或 panel/operator surface。

## 目标

第一版 public entry 的目标不是做复杂工作台，而是做一个面向最终用户可用的消费型聊天产品：

- 让用户可以登录并进入问答入口
- 让用户可以查看自己的会话记录并继续提问
- 让 public surface 保持 chat-first，而不是 panel-first
- 不暴露 specialist、runtime、provider 或内部编排概念

## Product Conclusion

第一版 public consumer surface 固定为：

`sidebar conversation history + primary chatbox + app-level user session`

关键结论：

- 它是一个轻量聊天产品，不是 dashboard、workspace 或 operator panel。
- 页面形态参考常见 consumer chat 产品，但只保留最小必要能力。
- public chat surface 属于用户前台，不承担 supervisor routing、specialist delegation 或 retrieval semantics。
- public chat surface 的复杂性应尽量停留在 UI、session、conversation ownership 和 answer rendering，不向 `packages/*` 扩散。

## Repo Shape

如果后续落地，repo shape 固定为：

- lives under `apps/` as a separate consumer-facing app
- remains separate from `apps/public-entry-worker`
- remains separate from `apps/supervisor-api`
- consumes runtime APIs only

这意味着：

- `apps/public-entry-worker`
  继续负责 public hostname、edge admission、trusted-origin forwarding 和 outer access posture
- future public consumer app
  负责用户界面、前端路由、conversation list、message rendering 和 app-level session UX
- `apps/supervisor-api`
  继续作为 repo-owned runtime ingress，承接对话请求并进入 supervisor path

不允许把 consumer app 混成：

- `public-entry-worker` 的 UI 模式
- `apps/supervisor-api` 的模板页面
- `packages/*` 的直接消费方

## Page Shape

第一版页面形态固定为单一 chat-first surface：

- left sidebar
  只显示当前用户自己的 conversation history 与 `new chat`
- primary chat panel
  显示当前 conversation 的消息流、空态、回答态、澄清态和错误态
- lightweight top bar
  显示产品名、当前用户、sign out / account entry

默认不包含：

- multi-panel workspace
- source management panel
- admin/operator affordance
- specialist switcher
- runtime/model selector

## Minimal Information Architecture

第一版最小信息架构固定为：

- `/login`
- `/chat`
- `/chat/:conversationId`

其中：

- `/login`
  负责进入 public consumer app，不承担 panel/operator 登录含义
- `/chat`
  打开最近一次 conversation，或创建一个新会话
- `/chat/:conversationId`
  展示并继续某条用户拥有的对话

默认不需要单独设计：

- settings
- profile management center
- team/workspace switcher
- admin route
- public docs/catalog route

第一版产品默认应按 `authenticated-first` 设计。

- `anonymous-enabled`
  仍然可以作为 Worker entry mode 能力存在
- 但它不是当前 consumer chat product 的默认 MVP 形态

## Minimal Interaction Flow

第一版交互流固定为：

1. 用户进入 public chat surface
2. 如果当前模式要求登录，则先完成 app-level sign-in
3. 用户看到 sidebar 与当前 conversation
4. 用户输入问题并提交
5. UI 进入 sending / waiting 状态
6. 系统返回以下之一：
   - completed answer
   - clarification request
   - error
7. 用户继续在同一 conversation 中追问或新建会话

第一版不要求：

- 多会话并排
- workflow canvas
- tool invocation timeline
- human handoff console

## Required States

第一版必须显式设计以下状态：

- `login`
  用户尚未进入 app-level session，页面只提供继续登录的明确动作
- `empty`
  当前没有 conversation 内容，显示 welcome copy、范围提示和少量示例问题
- `answer`
  正常显示 user message、assistant answer，以及必要时的引用/出处区域
- `clarification`
  assistant 明确说明缺少的信息，并允许用户继续补充
- `error`
  当前请求失败，显示简短失败原因、重试入口和 request correlation hint
- `history`
  sidebar 展示用户自己的 conversation list，并允许切换当前线程

其中：

- `clarification` 是正常产品态，不应被渲染成异常错误
- `history` 是第一版的必要能力，不再把 public entry 定义成“单输入框即弃”的极简落地页

## User System Boundary

第一版 public consumer app 需要 app-level user session，但不在此文中宣称已经完成 Phase 5 actor/ACL 闭环。

这里冻结：

- 用户必须只能看到自己的 conversation history
- conversation ownership 属于 app-layer concern，而不是 Worker concern
- app-level session 可以驱动登录态、登出、会话归属和基本 UX
- Worker-side admission 不能被当作最终 app-layer identity 真相

因此：

- Worker 可以判断请求是否允许进入 public path
- consumer app 可以拥有 sign-in / session UX
- `SupervisorRequest.actor`、retrieval ACL、audit closure 仍属于后续应用层闭环

同时第一版 consumer app 到 answer path 的浏览器侧 transport 应按 same-site routing 规划；cross-origin 调用如果未来需要，应作为单独显式决策处理，而不是当前 MVP 的默认假设。

当前 app auth 与数据归属的冻结结论见 `docs/architecture/public-consumer-chat-auth-and-data-boundary.md` 与 `docs/decisions/adr-0008-public-consumer-auth-and-storage.md`。

## Data And Conversation Scope

第一版前台只需要最小 conversation 数据模型：

- user
- conversation
- message

最低要求：

- conversation title 可由首句截断或后端生成
- conversation list 只展示当前用户数据
- UI 允许 continuation，不要求复杂长期记忆产品能力

默认不在第一版设计：

- shared conversations
- team permissions
- folder/tag system
- attachment library
- long-term memory product surface

## Non-Goals

- 不设计 protected internal panel、admin 或 operator workflow
- 不把 public chat surface 变成 edge orchestrator
- 不在前台暴露 specialist/runtime/provider 概念
- 不在 Worker 层拥有 canonical user system 或 retrieval ACL truth
- 不冻结最终 deployment substrate
- 不新增与 public answer 无关的入口协议或多工具工作台
