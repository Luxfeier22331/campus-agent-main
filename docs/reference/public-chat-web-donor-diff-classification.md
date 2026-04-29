---
doc_type: reference
status: active
created: 2026-04-11
updated: 2026-04-29
---
# Public Chat Web Donor Diff Classification

## 文档边界

本文固定 `apps/public-chat-web` 在 donor tech-debt convergence 收口后的 donor diff 分类结果。

本文回答的是：

- 本地 donor checkout 对比 `apps/public-chat-web/vendor/vercel-ai-chatbot/` 还剩哪些真实
  diff
- 这些 diff 分别属于 accepted product diff、accepted runtime compatibility diff，还是
  historical debt
- exact compat seam 由哪些 repo-owned 文件持有

本文同时吸收了旧 `public-chat-web-chatbot-donor-baseline.md` 与
`public-chat-web-donor-diff-whitelist.md` 的 canonical 内容。

本文不负责：

- 重新定义 strict donor parity 的 smoke / staging evidence
- 把 upstream donor 根目录里未 vendored 的 meta 文件误记成产品壳 drift

## 当前结论

当前 remaining historical debt 路径数为 `0`。

- 当前 repo-tracked donor diff truth 由本文的 machine-readable inventory、whitelist
  policy 和 exact compat seam owner 共同固定。
- 如果本地存在 donor snapshot，可以额外做严格 byte-level 对比；如果该临时 checkout 已按本地清理策略移除，则 gate
  退回到 repo-tracked inventory/doc/seam 校验，不把“缺少本地 donor 快照”视为回归。

## Donor Baseline

- upstream repo URL: `<https://github.com/vercel/chatbot`>
- GitHub current canonical page: `<https://github.com/vercel/ai-chatbot`>
- strict-comparison baseline checkout: local donor checkout
- baseline commit: `691c3cb05fddf292e1f52788d383937740c57cb9`
- baseline recorded at: `2026-04-09`
- license posture: `Apache-2.0`

当前 donor 承担的角色固定为：

- `interaction/layout/style-system donor`
- `frontend component and shell behavior donor`

它不是：

- 产品架构 donor
- auth/session truth donor
- conversation/request truth donor
- backend/runtime/deployment donor

## Allowed And Forbidden Inheritance

允许继承的 donor-visible 范围固定为：

- chat-first shell 布局
- sidebar / history / composer / message list 的 DOM 结构、样式层次和交互节奏
- empty / loading / error / history states 的可见组织方式
- donor 使用的前端原语方向
- chat shell 的可见组件行为

允许通过 repo-owned seam 接入、但不得改变 donor-visible behavior 的内容固定为：

- same-site `/api/*` transport seam
- `app-api` owned auth/session/conversation/request truth
- Worker route integration
- repo-owned `/login`、`/register`

禁止直接继承的范围固定为：

- Next.js App Router / React Server Components / Server Actions
- upstream `app/api/*` backend routes
- upstream auth / DB / Blob / provider persistence ownership
- 任何要求 browser 直连 backend provider 的默认实现

## Whitelist Policy

当前 `apps/public-chat-web` 只允许保留以下 donor diff 类型：

- `accepted product diff`
- `accepted runtime compatibility diff`
- `exact compat seam`
- 不改变结构与交互语义的中文 product copy

除此之外，launch path 上的 donor-visible drift 一律不接受。

补充规则：

- `campus` chat mode 固定 `private-only`；share / visibility 不得重新回到 launch path
- repo-owned visible fallback、patched status card、patched tool error
  card、patched artifact placeholder 一律视为 regression
- 平台兼容必须继续收口到 repo-owned exact seam；不得把 compat truth 重新写回 vendor runtime 深处

## 分类基线

当前 donor diff 固定分成三层：

- `accepted product diff`
- `accepted runtime compatibility diff`
- `exact compat seam owner`

remaining historical debt 路径数固定为 `0`。

machine-check gate 固定要求：

- vendor diff 集必须与本文 inventory 完全一致
- `app/globals.css` 继续保留在 inventory 内，但 worker-lane diff test 只对其余源码路径做
  byte-level 集合比对；`globals.css` 仍通过本文 inventory、whitelist 文档与 fresh `build` 共同约束
- exact compat seam owner 集必须与 `vite.config.ts` / `tsconfig.json` 完全一致
- 新长出的 vendor diff 如果不在本文 inventory 内，直接视为 regression

upstream donor 根目录存在但 vendor landing zone 不承接的 meta-only 路径如下：

- `.cursor/rules/ultracite.mdc`
- `.github/workflows/lint.yml`
- `.github/workflows/playwright.yml`
- `.vscode/extensions.json`
- `.vscode/settings.json`

generated donor path 中按上游框架约定忽略、且不进入 vendor diff baseline 的路径如下：

- `next-env.d.ts`：Next.js typegen 生成文件，当前 vendor snapshot 不承接 Next runtime
  typegen output

## Accepted Product Diffs

这些路径仍然对 donor 有 diff，但它们承载的是产品边界或 accepted runtime behavior，不是 historical debt。

- Path: `artifacts/actions.ts`
  原因: artifact suggestions 已固定为 same-site `/api/suggestions` ownership，并通过 exact
  compat seam 承接 `@/lib/db/queries`

- Path: `components/chat/chat-header.tsx`
  原因: launch path 固定 `private-only`，share / visibility affordance 已从主路径脱线

- Path: `components/chat/greeting.tsx`
  原因: donor greeting 文案已替换为 campus-domain 中文文案，但不改布局与动效结构

- Path: `components/chat/message-editor.tsx`
  原因: donor message edit 通过 same-site conversation API 承接 delete-trailing
  ownership

- Path: `components/chat/message.tsx`
  原因: assistant `data-place-card` 渲染是当前 campus place-finding 产品能力，需要在 donor
  thread shell 内承接结构化地点卡片

- Path: `components/chat/multimodal-input.tsx`
  原因: first-turn route reservation、same-site upload/model fetch、repo request
  contract 需要在 donor composer 上接入

- Path: `components/chat/shell.tsx`
  原因: active chat 需要把 `prepareConversationRoute` 与当前 edit flow 接回 repo runtime
  truth，同时保持 donor shell 组合

- Path: `components/chat/sidebar-history-item.tsx`
  原因: share / public affordance 已退出 launch path，history item 只保留当前产品允许的动作

- Path: `components/chat/sidebar-user-nav.tsx`
  原因: 当前 sign-out 目标固定回 `/login`，与 repo-owned auth surface 对齐

- Path: `components/chat/suggested-actions.tsx`
  原因: suggested actions 需要在 donor shell 内预留 conversation route，并走 same-site send
  path

## Accepted Runtime Compatibility Diffs

这些路径的 diff 不改变 donor-visible 行为，只承担 Worker / Vite / TypeScript / app-api payload
compatibility。

- Path: `app/globals.css`
  原因: Vite/Tailwind runtime 不直接复用 donor root 的 `katex` / `@source streamdown`
  import 入口

- Path: `artifacts/text/client.tsx`
  原因: same-site suggestions 返回的时间字段需要在 client artifact path 上显式归一化

- Path: `components/chat/document-preview.tsx`
  原因: `RefObject` 类型需要对齐当前 React/TS nullability

- Path: `components/chat/sidebar-history.tsx`
  原因: pagination key 与 pathname 读取需要对齐当前 TS nullability

- Path: `components/chat/toolbar.tsx`
  原因: toolbar ref / timeout typing 需要对齐当前 React/TS runtime

## Exact Compat Seam Owners

这些 repo-owned 文件是 exact compat seam 的唯一 owner；vendor runtime 继续保留 donor
specifier，不允许把 runtime truth 重新写回 vendor tree。

- Specifier: `next/link`
  Owner Path: `src/platform/vendor-compat/next/link.tsx`
  当前模式: exact alias

- Specifier: `next/navigation`
  Owner Path: `src/platform/vendor-compat/next/navigation.ts`
  当前模式: exact alias

- Specifier: `next/image`
  Owner Path: `src/platform/vendor-compat/next/image.tsx`
  当前模式: exact alias

- Specifier: `next-auth/react`
  Owner Path: `src/platform/vendor-compat/next-auth/react.tsx`
  当前模式: exact alias

- Specifier: `next-auth`
  Owner Path: `src/platform/vendor-compat/next-auth/index.ts`
  当前模式: exact alias

- Specifier: `@streamdown/code`
  Owner Path: `src/platform/vendor-compat/streamdown/code.ts`
  当前模式: exact alias

- Specifier: `@/app/(chat)/actions`
  Owner Path: `src/platform/vendor-compat/app/chat-actions.ts`
  当前模式: exact alias

- Specifier: `@/hooks/use-active-chat`
  Owner Path: `src/platform/vendor-compat/hooks/use-active-chat.ts`
  当前模式: exact alias

- Specifier: `@/hooks/use-chat-visibility`
  Owner Path: `src/platform/vendor-compat/hooks/use-chat-visibility.ts`
  当前模式: exact alias

- Specifier: `@/lib/ai/models`
  Owner Path: `src/platform/vendor-compat/lib/ai/models.ts`
  当前模式: exact alias

- Specifier: `@/lib/constants`
  Owner Path: `src/platform/vendor-compat/lib/constants.ts`
  当前模式: exact alias

- Specifier: `@/lib/db/schema`
  Owner Path: `src/platform/vendor-compat/lib/db/schema.ts`
  当前模式: exact alias

- Specifier: `@/lib/db/queries`
  Owner Path: `src/platform/vendor-compat/lib/db/queries.ts`
  当前模式: importer-scoped compat resolver
  (`vendor/vercel-ai-chatbot/artifacts/actions.ts`)

- Specifier: `@/lib/editor/diff`
  Owner Path: `src/platform/vendor-compat/lib/editor/diff.ts`
  当前模式: exact alias

- Specifier: `@/lib/types`
  Owner Path: `src/platform/vendor-compat/lib/types.ts`
  当前模式: exact alias

- Specifier: `@/lib/utils`
  Owner Path: `src/platform/vendor-compat/lib/utils.ts`
  当前模式: exact alias

- Specifier: `shiki`
  Owner Path: `src/platform/vendor-compat/shiki.ts`
  当前模式: importer-scoped compat resolver
  (`vendor/vercel-ai-chatbot/components/ai-elements/code-block.tsx`)

补充说明：

- `src/platform/vendor-compat/request-init-extensions.d.ts` 仍然是允许存在的 type-only
  compatibility shim，但它不是 exact import specifier seam owner

## Historical Debt

本文 inventory 中不再保留“以后再收”的 donor diff。

- historical debt 路径：`none`
- 如果后续新增路径，必须先回到 `accepted product diff` 或 `accepted runtime compatibility diff`
  的明确分类；否则视为 blocker

## Gate

分类由以下 gate 固定：

- [public-chat-donor-diff-classification.test.ts](/home/reptilian/code/campus-ag
  ent/apps/public-chat-web/test/public-chat-donor-diff-classification.test.ts)
- [public-chat-donor-diff-whitelist.test.ts](/home/reptilian/code/campus-agent/a
  pps/public-chat-web/test/public-chat-donor-diff-whitelist.test.ts)
- [chatbot-vendor-runtime-parity.test.ts](/home/reptilian/code/campus-agent/apps
  /public-chat-web/test/chatbot-vendor-runtime-parity.test.ts)

## 相关文件

- [public-chat-web-donor-parity-review-checklist.md](/home/reptilian/code/campus
  - agent/docs/reference/public-chat-web-donor-parity-review-checklist.md)
