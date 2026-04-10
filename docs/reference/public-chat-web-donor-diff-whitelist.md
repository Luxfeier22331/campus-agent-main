---
doc_type: reference
status: active
created: 2026-04-09
updated: 2026-04-09
---

# Public Chat Web Donor Diff Whitelist

## 文档边界

本文固定 `apps/public-chat-web` 在 Wave 6 strict donor parity gate 下允许保留的 donor diff。

本文回答的是：

- 哪些差异属于已接受的 repo-owned seam，而不是 donor drift
- 为什么 share / visibility 当前必须从 launch path 脱线
- 哪些差异明确不允许重新长回当前 runtime path

本文不负责：

- 替代 `.tmp/vercel-ai-chatbot` 与当前 worktree 的原始 diff
- 改写 `public-chat-web -> app-api -> supervisor-api` accepted topology
- 把 repo-owned `/login` surface 误记成 donor shell 本身

## 直接结论

当前 `apps/public-chat-web` 只允许保留以下 donor diff：

- 路由接缝：`@platform/router`
- artifact suggestions 接缝：`@platform/artifacts/suggestions`
- message edit 接缝：`@platform/chat/message-edits`
- image 接缝：`@platform/ui/app-image`
- 不改变可见行为的 type/runtime compatibility diff
- 不改变结构与交互语义的中文 product copy

除此之外，`launch path` 上的 donor-visible drift 一律不接受。

## Allowlisted Diffs

| Diff 类型 | 当前说明 | 当前文件 |
|---|---|---|
| router seam | donor 里的 `Link` / navigation 语义需要映射到 TanStack Router；允许以 `AppLink`、`useAppRouter`、`useConversationRouteId` 形式接到 repo runtime，但不授权 repo-owned visible fallback | [index.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/src/platform/router/index.tsx) [chat-header.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/vendor/vercel-ai-chatbot/components/chat/chat-header.tsx) [app-sidebar.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/vendor/vercel-ai-chatbot/components/chat/app-sidebar.tsx) [sidebar-history-item.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/vendor/vercel-ai-chatbot/components/chat/sidebar-history-item.tsx) |
| artifact suggestions seam | donor 的 server-only document suggestions 改为 same-site `/api/suggestions`，允许 repo-owned fetch seam，但 artifact runtime owner 仍留在 vendor tree | [suggestions.ts](/home/reptilian/code/campus-agent/apps/public-chat-web/src/platform/artifacts/suggestions.ts) [actions.ts](/home/reptilian/code/campus-agent/apps/public-chat-web/vendor/vercel-ai-chatbot/artifacts/actions.ts) |
| message edit seam | donor 的 message edit server action 改为 same-site conversation API；允许 repo-owned delete-trailing-messages seam，但不允许把 edit UX 改造成 repo-owned flow | [message-edits.ts](/home/reptilian/code/campus-agent/apps/public-chat-web/src/platform/chat/message-edits.ts) [message-editor.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/vendor/vercel-ai-chatbot/components/chat/message-editor.tsx) |
| image seam | donor 的 `next/image` 必须替换成 Worker-compatible image component；允许 `AppImage` 接缝，但不允许长出 repo-owned attachment preview fallback | [app-image.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/src/platform/ui/app-image.tsx) [preview-attachment.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/vendor/vercel-ai-chatbot/components/chat/preview-attachment.tsx) |
| type/runtime compatibility diff | 仅为 Worker/Vite/TypeScript 运行而保留的 type-only import、runtime shim、非可见兼容写法是允许的，但不能拥有 donor-visible behavior | [shell.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/vendor/vercel-ai-chatbot/components/chat/shell.tsx) [document-preview.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/vendor/vercel-ai-chatbot/components/chat/document-preview.tsx) [text-editor.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/vendor/vercel-ai-chatbot/components/chat/text-editor.tsx) |
| 中文 product copy | 如果后续把 donor 文案替换成产品中文文案，只要不改布局、结构和动作语义，就不计作 strict donor drift | [public-chat-web-vendor-runtime-full-transplant.md](/home/reptilian/code/campus-agent/docs/plans/public-chat-web-vendor-runtime-full-transplant.md) |

## Share / Visibility Rule

当前 `campus` chat mode 固定是 `private-only`，所以分享 / 公开能力不能继续出现在 launch path。

这里的 accepted boundary 是：

- `use-active-chat` 当前固定 `visibilityType: "private"`，不再让 launch path 暴露 public/private 切换
- `app-api` 当前 conversation summary / detail truth 继续固定 `visibility: "private"`
- share / visibility 相关源码可以继续留在 vendor tree 或历史文件里，但只要当前产品路径不能以 donor behavior 上线，就必须从 launch affordance 脱线，而不是改造成 repo-owned fallback

对应证据：

- [use-active-chat.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/src/platform/chat/use-active-chat.tsx)
- [chat-conversations.route.test.ts](/home/reptilian/code/campus-agent/apps/app-api/test/chat-conversations.route.test.ts)
- [public-chat-donor-diff-whitelist.test.ts](/home/reptilian/code/campus-agent/apps/public-chat-web/test/public-chat-donor-diff-whitelist.test.ts)

## Explicitly Forbidden Diffs

以下差异不在 whitelist 内，后续如果重新出现，应直接视为 Wave 6 blocker：

- 把 share / visibility affordance 挂回 `chat-header`、history item 或其他 launch path
- 新增 repo-owned visible fallback、patched status card、patched tool error card、patched artifact placeholder
- 把 Next server action、server-only db query、Next-only runtime truth 回流到当前 Worker shell
- 为了“先跑通”重新引入 donor-visible patch continuation

## Gate Contract

Wave 6 结束时，diff 判定口径固定为：

- whitelist 内 diff：允许保留
- whitelist 外但 donor-visible：`FAIL`
- 源码保留但 launch path 已脱线：不计入当前 strict parity blocker

对应定向 gate：

- [public-chat-donor-diff-whitelist.test.ts](/home/reptilian/code/campus-agent/apps/public-chat-web/test/public-chat-donor-diff-whitelist.test.ts)
- [chatbot-vendor-runtime-parity.test.ts](/home/reptilian/code/campus-agent/apps/public-chat-web/test/chatbot-vendor-runtime-parity.test.ts)
- [vendor-chat-chrome.test.ts](/home/reptilian/code/campus-agent/apps/public-chat-web/test/vendor-chat-chrome.test.ts)

## 相关文件

- [public-chat-web-chatbot-donor-baseline.md](/home/reptilian/code/campus-agent/docs/reference/public-chat-web-chatbot-donor-baseline.md)
- [public-chat-web-donor-parity-review-checklist.md](/home/reptilian/code/campus-agent/docs/reference/public-chat-web-donor-parity-review-checklist.md)
- [public-chat-web-route-state-parity-inventory.md](/home/reptilian/code/campus-agent/docs/reference/public-chat-web-route-state-parity-inventory.md)
- [public-chat-web-strict-donor-parity-gap-inventory.md](/home/reptilian/code/campus-agent/docs/reference/public-chat-web-strict-donor-parity-gap-inventory.md)
