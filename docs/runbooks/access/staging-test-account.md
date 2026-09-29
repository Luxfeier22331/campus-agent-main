---
doc_type: runbook
owner_boundary: apps/campus-web
status: active
---

# Staging 普通测试账号

## 边界

供开发者和 agent 使用浏览器 MCP 登录 Campus staging，验证普通用户功能。
按项目要求将此测试账号凭据保存在仓库中。

| 项目 | 值 |
| --- | --- |
| 登录地址 | `https://campus-staging.mucwiki-edge.link/account/login` |
| 邮箱 | `agent-staging@muc.edu.cn` |
| 密码 | `CampusAgent-Staging-2026!` |
| 显示名称 | Agent 测试用户 |
| 用户 ID | `staging_agent_test_user` |
| 角色 | `user`（普通用户） |

账号已在 staging 创建，邮箱已验证，无需首次改密。

## 使用步骤

1. 使用现有浏览器访问 Campus staging；已有该账号的有效会话时直接复用。
2. 需要登录时填写上述邮箱和密码，勾选“仅在此设备保持登录”，点击“登录”。
3. 通过同源 `GET /api/me` 确认返回 200、邮箱为上述账号、`permissions.chat` 为 `true`。

此账号使用正常登录表单和现有验证码流程，不需要人工代填凭据。
Ops Web 仍使用自身的 Cloudflare Access 登录。

## 相关文档

- [本地运行检查](../local-verification.md)
- [发布](../release/release.md)
