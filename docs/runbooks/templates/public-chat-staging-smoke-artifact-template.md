---
doc_type: runbook
status: active
created: 2026-04-10
updated: 2026-04-20
---
# Public Chat Staging Smoke Artifact Template

## 用途

这份模板用于 `docs/runbooks/dev-backed-supervisor-staging-smoke-runbook.md` 的
`public-chat` staging 浏览器验收产物。

它只记录“链路已打通”的脱敏证据，不记录回答质量判断，也不保存原始鉴权材料。

建议每轮执行时新建：

- `.tmp/staging-smoke/<timestamp>/SUMMARY.md`
- `.tmp/staging-smoke/<timestamp>/screenshots/`

## `SUMMARY.md` 模板

```md
# Public Chat Staging Smoke Summary

- Timestamp:
- Branch / commit:
- Supervisor upstream:
- Supervisor mode:
- Chat hostname:
- API hostname:
- Smoke identity email:

## Health

- `GET /readyz` chat:
- `GET /readyz` app-api:

## Auth

- Login path:
- Smoke identity reset command run: yes | no
- Login result:

## Chat Flow

- Prompt label:
- `conversationId`:
- `requestId`:
- `traceId`:
- `POST /api/chat/requests`:
- Typed outcome:
- Sidebar updated without reload: yes | no
- Reload preserved history: yes | no

## Evidence

- Login screenshot:
- Empty-state screenshot:
- Submitted-state screenshot:
- Response screenshot:
- Reloaded-history screenshot:

## Notes

-

## Redaction

- Raw `cookie` absent
- Raw `authorization` absent
- Password absent
- Session token absent
- Raw request / response body absent
```

## 强制脱敏规则

- 允许记录：HTTP 状态码、`conversationId`、`requestId`、`traceId`、页面路径、截图文件名
- 禁止记录：明文密码、`cookie`、`authorization`、session token、整段 request body、整段 response
  body
- 如果浏览器 DevTools 中看到敏感值，只能转写为摘要，不得原样落盘
