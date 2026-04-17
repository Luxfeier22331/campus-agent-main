---
doc_type: reference
status: active
created: 2026-04-09
updated: 2026-04-12
---

# Public Chat Web Donor Diff Whitelist

## 文档边界

本文固定 `apps/public-chat-web` 在 Wave 6 strict donor parity gate 下允许保留的 donor diff。

本文回答的是：

- 哪些差异属于已接受的 repo-owned seam，而不是 donor drift
- 为什么 share / visibility 当前必须从 launch path 脱线
- 哪些差异明确不允许重新长回当前 runtime path
- 当前 whitelist policy 应该和哪份 diff inventory 文档配套阅读

本文不负责：

- 替代 `.tmp/vercel-ai-chatbot` 与当前 vendor tree 之间的原始 diff
- 改写 `public-chat-web -> app-api -> supervisor-api` accepted topology
- 把 repo-owned `/login` surface 误记成 donor shell 本身

## 直接结论

`apps/public-chat-web` 只允许保留以下 donor diff 类型：

- exact 路由兼容接缝：`next/link`、`next/navigation`
- exact vendor lib compat seam：`@/lib/ai/models`、`@/lib/constants`、`@/lib/db/schema`、`@/lib/editor/diff`、`@/lib/types`、`@/lib/utils`
- exact message action 接缝：`@/app/(chat)/actions`
- exact image 兼容接缝：`next/image`
- artifact suggestions 接缝：`@/lib/db/queries`
- 不改变可见行为的 type/runtime compatibility diff
- 不改变结构与交互语义的中文 product copy

除此之外，`launch path` 上的 donor-visible drift 一律不接受。

path-level inventory 已从 whitelist policy 中拆出，固定看：

- [public-chat-web-donor-diff-classification.md](/home/reptilian/code/campus-agent/docs/reference/public-chat-web-donor-diff-classification.md)

## Allowlisted Diffs

| Diff 类型 | 说明 | 当前文件 |
|---|---|---|
| accepted product diff | 允许保留产品边界导致的 donor diff，例如 private-only launch path、same-site request ownership、campus-domain copy；具体路径 inventory 固定在分类文档，不再在 whitelist policy 内重复列出 | [public-chat-web-donor-diff-classification.md](/home/reptilian/code/campus-agent/docs/reference/public-chat-web-donor-diff-classification.md) |
| exact compat seam | donor specifier 继续保留在 vendor runtime import 上，但 runtime truth 必须由 repo-owned exact seam owner 承担；具体 specifier / owner path inventory 固定在分类文档 | [public-chat-web-donor-diff-classification.md](/home/reptilian/code/campus-agent/docs/reference/public-chat-web-donor-diff-classification.md) |
| type/runtime compatibility diff | 仅为 Worker/Vite/TypeScript/runtime payload 兼容而保留的非可见 diff 是允许的，但不能拥有 donor-visible behavior；具体路径 inventory 固定在分类文档 | [public-chat-web-donor-diff-classification.md](/home/reptilian/code/campus-agent/docs/reference/public-chat-web-donor-diff-classification.md) |

## Share / Visibility Rule

`campus` chat mode 固定是 `private-only`，所以分享 / 公开能力不能继续出现在 launch path。

这里的 accepted boundary 是：

- `use-active-chat` 固定 `visibilityType: "private"`，不再让 launch path 暴露 public/private 切换
- `app-api` 的 conversation summary / detail truth 固定 `visibility: "private"`
- share / visibility 相关源码可以继续留在 vendor tree 或历史文件里，但只要当前产品路径不能以 donor behavior 上线，就必须从 launch affordance 脱线，而不是改造成 repo-owned fallback

对应证据：

- [use-active-chat.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/src/platform/chat/use-active-chat.tsx)
- [chat-conversations.route.test.ts](/home/reptilian/code/campus-agent/apps/app-api/test/chat-conversations.route.test.ts)
- [public-chat-donor-diff-whitelist.test.ts](/home/reptilian/code/campus-agent/apps/public-chat-web/test/public-chat-donor-diff-whitelist.test.ts)

## Explicitly Forbidden Diffs

以下差异不在 whitelist 内，后续如果重新出现，应直接视为 Wave 6 blocker：

- 把 share / visibility affordance 挂回 `chat-header`、history item 或其他 launch path
- 新增 repo-owned visible fallback、patched status card、patched tool error card、patched artifact placeholder
- 把 Next server action、server-only db query、Next-only runtime truth 回流到当前 Worker shell；或重新把 compat seam 直接写死到 vendor runtime import 路径
- 把已迁出的 `@/lib/*` runtime truth 再次写回 `vendor/vercel-ai-chatbot/lib/*`
- 为了“先跑通”重新引入 donor-visible patch continuation

## Gate Contract

diff 判定口径固定为：

- whitelist 内 diff：允许保留
- whitelist 外但 donor-visible：`FAIL`
- 源码保留但 launch path 已脱线：不计入当前 strict parity blocker

对应定向 gate：

- [public-chat-donor-diff-classification.test.ts](/home/reptilian/code/campus-agent/apps/public-chat-web/test/public-chat-donor-diff-classification.test.ts)
- [public-chat-donor-diff-whitelist.test.ts](/home/reptilian/code/campus-agent/apps/public-chat-web/test/public-chat-donor-diff-whitelist.test.ts)
- [chatbot-vendor-runtime-parity.test.ts](/home/reptilian/code/campus-agent/apps/public-chat-web/test/chatbot-vendor-runtime-parity.test.ts)
- [vendor-chat-chrome.test.ts](/home/reptilian/code/campus-agent/apps/public-chat-web/test/vendor-chat-chrome.test.ts)

## 相关文件

- [public-chat-web-donor-diff-classification.md](/home/reptilian/code/campus-agent/docs/reference/public-chat-web-donor-diff-classification.md)
- [public-chat-web-chatbot-donor-baseline.md](/home/reptilian/code/campus-agent/docs/reference/public-chat-web-chatbot-donor-baseline.md)
- [public-chat-web-donor-parity-review-checklist.md](/home/reptilian/code/campus-agent/docs/reference/public-chat-web-donor-parity-review-checklist.md)
- [public-chat-web-route-state-parity-inventory.md](/home/reptilian/code/campus-agent/docs/reference/public-chat-web-route-state-parity-inventory.md)
- [public-chat-web-strict-donor-parity-gap-inventory.md](/home/reptilian/code/campus-agent/docs/reference/public-chat-web-strict-donor-parity-gap-inventory.md)
