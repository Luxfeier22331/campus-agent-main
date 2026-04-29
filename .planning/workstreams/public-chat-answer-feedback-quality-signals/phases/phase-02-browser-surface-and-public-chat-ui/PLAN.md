---
doc_type: phase_plan
status: completed
created: 2026-04-29
updated: 2026-04-29
---

# Phase 2 Plan: Browser Surface And Public Chat UI

Status: completed on 2026-04-29. Summary is recorded in `SUMMARY.md`.

## Goal

在 public-chat-web 中恢复用户可见 feedback action，并确保所有写入都通过 app-api。

## Tasks

1. 新增 repo-owned feedback API helper。
2. 更新 Worker forwarding / same-site API tests。
3. 在 assistant message actions 中展示 copy、helpful、unhelpful。
4. 为 unhelpful 增加 reason choices，是否支持 comment 按 Phase 0 结论执行。
5. 实现 submitted / selected / retry / error states。
6. 确保 UI 只对 assistant finalized message 展示。
7. 更新 vendor compatibility 类型，避免继续使用 donor `Vote` 语义污染 repo-owned API。
8. 保留 regression test：不调用 `/api/vote`，不导入 donor DB query。

## UX Rules

- 文案使用“有帮助 / 没有帮助”或等价问答质量语义。
- 不展示公开投票数，不暗示社区排名。
- negative reason 是质量诊断输入，不承诺即时重答或人工处理。

## Exit Criteria

- 用户可以对 assistant answer 提交和修改反馈。
- 刷新或重新打开 conversation 时能展示 latest feedback state，前提是 Phase 1 contract 支持读取。
- unsupported donor vote route 保持关闭。

## Verification

- `pnpm --dir apps/public-chat-web typecheck`
- `pnpm --dir apps/public-chat-web test:worker`
- public-chat-web component / interaction tests
