# Agent Note: 默认登录使用持久会话

Status: implemented

## 背景

Campus 默认登录原本使用一周会话，登录表单又默认取消“仅在此设备保持登录”。这与用户希望保持登录的默认体验不一致，也没有充分利用 Better Auth 已有的持久会话与短会话语义。该改动需要同时更新服务端会话配置、前端请求默认值、产品合同和回归验证。

## 决策

使用 Better Auth 原生会话设计：服务端将默认 `session.expiresIn` 设为 30 天，`session.updateAge` 保持 24 小时；登录表单默认发送 `rememberMe: true`，用户取消勾选时发送 `rememberMe: false`。邮箱验证后的自动登录继续使用 Better Auth 默认持久会话。

保留现有复选框和同源 Cookie、CSRF、Origin 校验及数据库会话存储，不自定义 Cookie，不新增数据库字段或迁移，不添加后台定时续期，也不强制注销已有会话。持久会话和短会话的有效期由 Better Auth 根据同一配置创建，前端只表达用户选择。

## 未采用方案

- **自定义 Cookie 有效期或在前端定时续期**：Better Auth 已经根据 `expiresIn`、`updateAge` 和 `rememberMe` 完成会话生命周期管理，重复实现会造成两个续期 owner。
- **新增会话类型字段或数据库迁移**：`rememberMe: false` 已由 Better Auth 原生映射为 24 小时短会话，不需要改变现有 schema。
- **把持久会话限制为新的 90 天上限或强制注销旧会话**：当前需求只要求默认 30 天滑动会话，额外上限和历史会话清理没有现有消费者或故障依据。

## 后果

默认登录和邮箱验证后的自动登录获得 30 天会话，并在达到 24 小时更新阈值后按访问滑动续期；取消勾选时仍获得约 24 小时的短会话。前端组件测试覆盖默认勾选、自动填充登录携带 `rememberMe: true` 和取消勾选后的短会话请求；PostgreSQL 集成测试覆盖持久 Cookie、短会话 Cookie 及数据库 `expiresAt` 时间窗口。
