---
doc_type: plan
status: completed
created: 2026-04-10
updated: 2026-04-11
---

# Public Chat Web Vendor Tech Debt Convergence

## 文档边界

本文固定 `apps/public-chat-web` 在 strict donor parity closeout 之后的前向收口策略。

本文回答的是：

- strict parity 已关闭之后，`public-chat-web` 还剩哪些 donor 技术债
- 应如何把 vendor diff 从“可接受运行态”收口到“可维护 donor shell”
- exact-specifier adapter layer 应该怎么建，哪些 diff 可以优先收回

本文不负责：

- 改写 `public-chat-web -> app-api -> supervisor-api` accepted topology
- 重新定义 strict donor parity 的 whitelist
- 为了“先跑通”引入新的 overlay、fallback 或 repo-owned visible shell

## 直接结论

当前 `public-chat-web` 的下一步不是重做 donor parity，而是执行：

`donor reset + exact-specifier adapter + whitelist shrink`

固定目标：

- `vendor/vercel-ai-chatbot/` 继续拥有 chat shell 的可见 UI
- `src/platform/` 继续拥有 repo runtime、route、auth、Worker seam
- repo-owned 差异不再散落在 vendor runtime 文件里，而是尽量收口到 exact-specifier adapter
- whitelist 只保留真正不可避免、且已被产品边界接受的 diff

## 当前技术债类型

当前剩余 donor 技术债主要分成三类：

1. import-level drift
   - donor runtime 文件为了适配 Worker / Better Auth / TanStack Router，被直接改写成 `@platform/*` import
   - 这些差异多数不改变可见行为，但扩大了 vendor tree 的维护面
2. vendor lib drift
   - `vendor/vercel-ai-chatbot/lib/*` 内仍有一批 repo-owned 运行时改写
   - 这些差异让后续 donor reset 很难判断哪些是产品必要差异，哪些只是历史补丁
3. whitelist 与 debt 混杂
   - 当前 whitelist 已经区分了可接受 diff，但还没有把“临时允许的结构性债务”进一步拆掉

## 固定原则

本轮收口必须遵守以下原则：

- 不重新发明 chat shell；继续以 donor shell 为 owner
- 不新增 repo-owned visible fallback
- 不为了减少 diff 而把 share / visibility 重新挂回 launch path
- 不把 `app-api`、auth、route、image 这些平台差异重新塞回 donor tree 深处
- 只允许通过 exact-specifier seam 承接平台差异，不接受继续扩大 broad patch 面

## 目标形态

目标形态固定为：

`vendor-owned chat shell + repo-owned exact compat seams`

具体约束：

- broad alias 继续保持：
  - `@/* -> vendor/vercel-ai-chatbot/*`
  - `@platform/* -> src/platform/*`
- 新增 exact alias，只处理被平台替换的 donor specifier
- vendor runtime 文件优先恢复 donor specifier，不再直接引用 repo-local implementation path

## 当前状态（2026-04-11）

本轮收口后，`apps/public-chat-web/vendor/vercel-ai-chatbot/` 的 direct `@platform/*` import 已清零。

当前已完成的收口点：

- `next/*`、`next-auth/*`、`@streamdown/code`、`@/app/(chat)/actions`、`@/hooks/use-active-chat`、`@/hooks/use-chat-visibility` 已收口到 exact compat seam
- `artifacts/actions.ts` 已恢复 donor `@/lib/db/queries` specifier，并通过 importer-scoped compat resolver 映射到 same-site `/api/suggestions`
- `components/ai-elements/code-block.tsx` 已恢复 donor `shiki` specifier，并通过 importer-scoped compat resolver 映射到 Worker-compatible lazy Shiki runtime
- `@/lib/ai/models`、`@/lib/constants`、`@/lib/db/schema`、`@/lib/editor/diff`、`@/lib/types`、`@/lib/utils` 已收口到 exact compat seam；对应 `vendor/vercel-ai-chatbot/lib/*` 已恢复 donor source

本轮验证证据：

- `rg -n '@platform/' apps/public-chat-web/vendor/vercel-ai-chatbot -g '*.ts' -g '*.tsx'` 返回空结果
- `pnpm --dir apps/public-chat-web typecheck`
- `pnpm --dir apps/public-chat-web exec vitest run test/public-chat-router-cutover.test.ts test/chatbot-vendor-runtime-parity.test.ts test/public-chat-donor-diff-whitelist.test.ts test/public-chat-donor-diff-classification.test.ts`
- `pnpm --dir apps/public-chat-web test:worker`
- `pnpm --dir apps/public-chat-web build`
- fresh local live-smoke closeout:
  - [SUMMARY.md](/home/reptilian/code/campus-agent/.tmp/local-smoke/20260411T163903+0800-public-chat-wave5-closeout/SUMMARY.md)
  - [network-summary.md](/home/reptilian/code/campus-agent/.tmp/local-smoke/20260411T163903+0800-public-chat-wave5-closeout/network-summary.md)

Wave 5 closeout 已完成后，本计划不再保留新的 active wave。后续如果继续推进 `public-chat-web`，应直接进入 repo 级 post-closeout follow-up，而不是重开 donor tech-debt convergence。

剩余 donor 差异已收敛为：

- chat runtime 中仍保留真实产品语义差异的文件
- `app/globals.css` 与中文产品 copy 相关差异
- Wave 5 已关闭；Wave 4 已把 path inventory、exact seam owner 和 zero-historical-debt gate 固定下来

## Wave 计划

### Wave 1：Exact-Specifier Adapter Foundation

目标：

- 在 `src/platform/vendor-compat/` 建立 exact adapter layer
- 让 donor runtime 文件恢复使用 donor specifier

首批 exact seam：

- `next/link`
- `next/navigation`
- `next/image`
- `next-auth`
- `next-auth/react`
- `@/hooks/use-active-chat`
- `@/hooks/use-chat-visibility`

首批优先收回的 vendor 文件：

- `components/chat/shell.tsx`
- `components/chat/preview-attachment.tsx`
- `components/chat/app-sidebar.tsx`
- `components/chat/sidebar-history.tsx`
- `components/chat/sidebar-user-nav.tsx`
- `components/chat/chat-header.tsx`
- `components/chat/sidebar-history-item.tsx`

### Wave 2：Runtime Diff Reset

目标：

- 把 runtime 上仍然只是“specifier 被改了”的 patch 收回
- 保留真正有产品语义差异的 patch，例如：
  - private-only share removal
  - same-site `/api/*` transport ownership
  - message edit / artifact suggestion seam

### Wave 3：Vendor Lib Shrink

目标：

- 梳理 `vendor/vercel-ai-chatbot/lib/*` 当前差异
- 把平台差异迁出 vendor lib，收口到 repo-owned seam
- 能恢复 donor 文件的尽量恢复，不再让 vendor lib 承担 repo runtime owner

### Wave 4：Gate 与 Whitelist 收紧

目标：

- 测试中显式区分：
  - accepted product diff
  - exact compat seam
  - 仍待收口的历史债务
- whitelist 文档不再混杂“当前 accepted”与“尚未收回”

当前完成情况（2026-04-11）：

- 新增 [public-chat-web-donor-diff-classification.md](/home/reptilian/code/campus-agent/docs/reference/public-chat-web-donor-diff-classification.md)，把 remaining vendor diff 明确分成 `accepted product diff`、`accepted runtime compatibility diff`、`exact compat seam owner`
- whitelist policy 现只保留规则，不再承担 path inventory
- 新增 [public-chat-donor-diff-classification.test.ts](/home/reptilian/code/campus-agent/apps/public-chat-web/test/public-chat-donor-diff-classification.test.ts)，对真实 donor diff 集做 machine-check；当前 `app/globals.css` 仍由 inventory + build 共同约束
- 清除了 `app-sidebar`、`data-stream-handler`、`messages` 里的纯格式 historical drift；`message.tsx` 当前作为 `accepted product diff` 保留 place-card 渲染；当前 historical debt 路径数为 `0`

### Wave 5：验证与 closeout

固定 gate：

- `pnpm --dir apps/public-chat-web typecheck`
- `pnpm --dir apps/public-chat-web exec vitest run test/public-chat-router-cutover.test.ts test/chatbot-vendor-runtime-parity.test.ts test/public-chat-donor-diff-whitelist.test.ts test/public-chat-donor-diff-classification.test.ts`
- `pnpm --dir apps/public-chat-web test:worker`
- `pnpm --dir apps/public-chat-web build`

当前 closeout 结果（2026-04-11）：

- 四条固定 gate 已 fresh 通过
- fresh local live-smoke evidence 已固定在 `.tmp/local-smoke/20260411T163903+0800-public-chat-wave5-closeout/`
- local smoke 已确认 same-site `GET /api/me`、`GET /api/models`、`GET /api/history?limit=20` 与 `POST /api/chat/requests` 在真实浏览器会话下可达
- 这轮 `POST /api/chat/requests` 已不再触发先前的 `500`；真实 local 根因是本地 `chat.messages` 漏跑 `db/shared-product-migrations/0004_chat_message_structured_parts.sql`
- 本轮修复动作是重跑 `pnpm --dir apps/app-api db:bootstrap`，而不是在 `public-chat-web` 或 `app-api` 里新增临时兼容逻辑
- 提交后的 typed outcome 为上游 supervisor `execution_timeout`，这说明 same-site app-api seam 与 history persistence 已正常，剩余问题属于上游执行耗时，不属于本计划的 donor shell / exact seam closeout blocker
- reload 后会话路由与 sidebar history 仍保持一致

本轮还固定了一条 local smoke 前置约束：

- 如果本地 Postgres 可能落后于 `apps/app-api/db/shared-product-migrations/`，必须先执行 `pnpm --dir apps/app-api db:bootstrap`
- `db:reconcile-shared-drift` 只覆盖 drizzle shared-db adoption truth，不覆盖这组 `chat.*` bootstrap migration；不能用它代替 `db:bootstrap`

## Wave 1 具体实施要求

Wave 1 交付时必须同时满足：

- Vite / TS config 中存在 exact-specifier alias
- `next/*` 与 `next-auth/*` 的 runtime 兼容只存在于 `src/platform/vendor-compat/`
- 选定的 vendor runtime 文件恢复 donor import specifier
- 现有 strict donor parity gate 不被破坏

## Definition Of Done

本文目标完成时，应满足：

- vendor runtime 文件只保留真正不可避免的行为差异
- specifier-level drift 被 exact compat seam 收口
- `vendor/vercel-ai-chatbot/` 不再承担 repo runtime path 的主要 patch owner
- 当前 donor diff 能被分成：
  - accepted product diff
  - accepted exact seam
  - zero remaining historical drift

## 相关文档

- [public-chat-web-chatbot-donor-baseline.md](/home/reptilian/code/campus-agent/docs/reference/public-chat-web-chatbot-donor-baseline.md)
- [public-chat-web-donor-diff-classification.md](/home/reptilian/code/campus-agent/docs/reference/public-chat-web-donor-diff-classification.md)
- [public-chat-web-donor-diff-whitelist.md](/home/reptilian/code/campus-agent/docs/reference/public-chat-web-donor-diff-whitelist.md)
- [public-chat-web-donor-parity-review-checklist.md](/home/reptilian/code/campus-agent/docs/reference/public-chat-web-donor-parity-review-checklist.md)
- [public-chat-web-strict-donor-parity-gap-inventory.md](/home/reptilian/code/campus-agent/docs/reference/public-chat-web-strict-donor-parity-gap-inventory.md)
- [public-chat-web-vendor-runtime-full-transplant.md](/home/reptilian/code/campus-agent/.planning/archive-docs/docs/plans/public-chat-web-vendor-runtime-full-transplant.md)
