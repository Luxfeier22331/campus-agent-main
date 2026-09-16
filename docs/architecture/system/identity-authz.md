---
doc_type: architecture
owner_boundary: apps/app-api
status: active
---

# 身份与权限

## 边界

App API 拥有产品账号、邮箱准入、会话、账号生命周期、调用方映射、用量限制和权限判断。Campus Web 组合账号界面，
execution-control 只消费执行所需的最小身份投影；Agent、检索和个人记忆运行时不读取认证材料。

## 数据所有权

- App API：Better Auth 账号与会话、邮箱准入授权、账号管理记录和注销任务；
- 身份来源：校园身份验证和所属身份声明；
- execution-control：消费已确认的调用方和权限投影，执行工具与文档范围准入；
- 机构知识：来源信任、版本和证据；
- Hindsight：当前用户范围内的个人记忆。

这些数据不能互相授予权限。用户陈述、记忆内容、聊天历史和检索结果都不能成为身份依据。

## 产品请求

App API 在接收产品请求时确认会话、账号状态、调用方类别和产品限制，再向 execution-control
发送有界身份与授权投影。execution-control 根据当前工具注册表、文档范围和所属数据权限执行
准入；工具自身继续校验领域输入和访问范围。

普通聊天用户只能使用注册表已经开放且本轮可用的只读模型工具。个人记忆是否可用由其生命周期派生，
不是额外授权，也不改变文档范围、机构来源信任或数据权限。完整行为由
[个人记忆](./memory-plane.md)和[执行合同](../../contracts/tool-execution.md)维护。

## 执行边界

执行链不接收原始 JWT、Cookie、会话行、完整资料表或联邦身份载荷。检索只处理已准入范围、
版本和证据，不解析账号、验证码或个人记忆内部可用性。

个人记忆可以支持用户自身事实和偏好，但不能决定账号、权限、机构来源信任或运维访问，也不能
替代正式机构来源。机构知识只能来自本轮成功工具返回且通过对应 adapter 校验的真实 evidence；当前
Campus Docs 来源由 `campus_search` 提供，不能由记忆或身份投影推导。

## 浏览器与外部服务

Campus Web 使用 App API 的认证接口和当前用户投影组合登录、注册、重置密码与账号设置界面，
不维护第二套认证实现。Turnstile 等人机验证只保护认证入口，其结果不进入 Agent、检索或记忆。

`muc.edu.cn` 邮箱可以直接注册；其他邮箱必须先获得逐地址邀请或测试授权，并在验证邮箱后绑定
授权。封禁、强制改密、会话撤销和注销均由 App API 执行。Ops Web 只通过固定内部接口管理这些
状态，不直连 Better Auth 表，也不能模拟登录或直接删除用户。

临时密码只在签发响应中出现一次，并要求用户登录后修改。注销先建立 App API 所有的异步任务，
再按以下顺序收敛账号生命周期：

1. App API 接受删除请求并撤销会话；
2. execution-control 为 `owner_user_id` 建立 deletion fence，阻止新 run，并为活动 run 写入或复用取消命令；
3. 等待活动 run 进入终态；
4. Hindsight 清除 bank 和 memory，并确认个人记忆调用与命令已排空；
5. execution-control 删除该 owner 的 execution projection；
6. App API 清理自己的账号关联数据，最后删除 Better Auth user。

execution-control 保留 `owner_deletion_fences(state=deleted)` 这一条最小 tombstone，用于阻止旧 workflow
或旧请求使 owner 复活；它不保存用户内容。Temporal history 不在账号删除事务中即时删除，由 Temporal
或平台 retention 合同负责。任务状态仍由 App API 生命周期拥有，不是 execution-control 或 Temporal 的
产品工作流状态。

外部 relying party 只能通过 App API 已登记的 OAuth/OIDC client 接入。双方不共享 Cookie、密码、
会话表或本地权限；App API 只发布获准的身份声明，外部服务继续拥有自己的账号关联、会话和权限。
协议边界见 [联邦登录合同](../../contracts/app-api/federation.md)。

## 禁止形态

- 把记忆、偏好、聊天历史或模型判断作为授权来源；
- 把原始认证或会话载荷发送给 Agent、检索或观测平台；
- 把 Ops Web 操作者身份解释为产品用户权限；
- 让验证码或供应商风险分数开放工具或文档范围；
- 导入外部服务的密码、会话或权限表。

## 相关文档

- [App API 登录合同](../../contracts/app-api/auth.md)
- [联邦登录合同](../../contracts/app-api/federation.md)
- [Campus Web 交付与同源边界 ADR](../../../.agents/notes/implemented/feature/2026-06-09-adr-0050-campus-web.md)
- [产品运行时](./product-runtime.md)
- [工具路由](./tool-routing.md)
- [个人记忆](./memory-plane.md)
