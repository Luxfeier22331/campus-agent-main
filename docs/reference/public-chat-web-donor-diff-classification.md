---
doc_type: reference
status: active
created: 2026-04-11
updated: 2026-04-12
---

# Public Chat Web Donor Diff Classification

## 文档边界

本文固定 `apps/public-chat-web` 在 donor tech-debt convergence 收口后的 donor diff 分类结果。

本文回答的是：

- `.tmp/vercel-ai-chatbot` 对比 `apps/public-chat-web/vendor/vercel-ai-chatbot/` 还剩哪些真实 diff
- 这些 diff 分别属于 accepted product diff、accepted runtime compatibility diff，还是 historical debt
- exact compat seam 由哪些 repo-owned 文件持有

本文不负责：

- 改写 donor diff whitelist 的 policy 规则
- 重新定义 strict donor parity 的 smoke / staging evidence
- 把 upstream donor 根目录里未 vendored 的 meta 文件误记成产品壳 drift

## 当前结论

当前 remaining historical debt 路径数为 `0`。

- 当前 repo-tracked donor diff truth 由本文的 machine-readable inventory、whitelist policy 和 exact compat seam owner 共同固定。
- 如果本地存在 `.tmp/vercel-ai-chatbot` donor snapshot，可以额外做严格 byte-level 对比；如果该临时目录已按仓库清理策略移除，则 gate 退回到 repo-tracked inventory/doc/seam 校验，不把“缺少本地临时快照”视为回归。

## 分类基线

当前 donor diff 固定分成三层：

- `accepted product diff`
- `accepted runtime compatibility diff`
- `exact compat seam owner`

remaining historical debt 路径数固定为 `0`。

machine-check gate 固定要求：

- vendor diff 集必须与本文 inventory 完全一致
- `app/globals.css` 继续保留在 inventory 内，但 worker-lane diff test 只对其余源码路径做 byte-level 集合比对；`globals.css` 仍通过本文 inventory、whitelist 文档与 fresh `build` 共同约束
- exact compat seam owner 集必须与 `vite.config.ts` / `tsconfig.json` 完全一致
- 新长出的 vendor diff 如果不在本文 inventory 内，直接视为 regression

upstream donor 根目录存在但 vendor landing zone 不承接的 meta-only 路径如下：

- `.cursor/rules/ultracite.mdc`
- `.github/workflows/lint.yml`
- `.github/workflows/playwright.yml`
- `.vscode/extensions.json`
- `.vscode/settings.json`

## Accepted Product Diffs

这些路径仍然对 donor 有 diff，但它们承载的是产品边界或 accepted runtime behavior，不是 historical debt。

| Path | 原因 |
|---|---|
| `artifacts/actions.ts` | artifact suggestions 已固定为 same-site `/api/suggestions` ownership，并通过 exact compat seam 承接 `@/lib/db/queries` |
| `components/chat/chat-header.tsx` | launch path 固定 `private-only`，share / visibility affordance 已从主路径脱线 |
| `components/chat/greeting.tsx` | donor greeting 文案已替换为 campus-domain 中文文案，但不改布局与动效结构 |
| `components/chat/message-editor.tsx` | donor message edit 通过 same-site conversation API 承接 delete-trailing ownership |
| `components/chat/message.tsx` | assistant `data-place-card` 渲染是当前 campus place-finding 产品能力，需要在 donor thread shell 内承接结构化地点卡片 |
| `components/chat/multimodal-input.tsx` | first-turn route reservation、same-site upload/model fetch、repo request contract 需要在 donor composer 上接入 |
| `components/chat/shell.tsx` | active chat 需要把 `prepareConversationRoute` 与当前 edit flow 接回 repo runtime truth，同时保持 donor shell 组合 |
| `components/chat/sidebar-history-item.tsx` | share / public affordance 已退出 launch path，history item 只保留当前产品允许的动作 |
| `components/chat/sidebar-user-nav.tsx` | 当前 sign-out 目标固定回 `/login`，与 repo-owned auth surface 对齐 |
| `components/chat/suggested-actions.tsx` | suggested actions 需要在 donor shell 内预留 conversation route，并走 same-site send path |

## Accepted Runtime Compatibility Diffs

这些路径的 diff 不改变 donor-visible 行为，只承担 Worker / Vite / TypeScript / app-api payload compatibility。

| Path | 原因 |
|---|---|
| `app/globals.css` | Vite/Tailwind runtime 不直接复用 donor root 的 `katex` / `@source streamdown` import 入口 |
| `artifacts/text/client.tsx` | same-site suggestions 返回的时间字段需要在 client artifact path 上显式归一化 |
| `components/chat/document-preview.tsx` | `RefObject` 类型需要对齐当前 React/TS nullability |
| `components/chat/sidebar-history.tsx` | pagination key 与 pathname 读取需要对齐当前 TS nullability |
| `components/chat/toolbar.tsx` | toolbar ref / timeout typing 需要对齐当前 React/TS runtime |
| `next-env.d.ts` | vendored donor tree 当前只保留 Next 类型兼容最小入口，不追随 donor dev-only route type path |

## Exact Compat Seam Owners

这些 repo-owned 文件是 exact compat seam 的唯一 owner；vendor runtime 继续保留 donor specifier，不允许把 runtime truth 重新写回 vendor tree。

| Specifier | Owner Path | 当前模式 |
|---|---|---|
| `next/link` | `src/platform/vendor-compat/next/link.tsx` | exact alias |
| `next/navigation` | `src/platform/vendor-compat/next/navigation.ts` | exact alias |
| `next/image` | `src/platform/vendor-compat/next/image.tsx` | exact alias |
| `next-auth/react` | `src/platform/vendor-compat/next-auth/react.tsx` | exact alias |
| `next-auth` | `src/platform/vendor-compat/next-auth/index.ts` | exact alias |
| `@streamdown/code` | `src/platform/vendor-compat/streamdown/code.ts` | exact alias |
| `@/app/(chat)/actions` | `src/platform/vendor-compat/app/chat-actions.ts` | exact alias |
| `@/hooks/use-active-chat` | `src/platform/vendor-compat/hooks/use-active-chat.ts` | exact alias |
| `@/hooks/use-chat-visibility` | `src/platform/vendor-compat/hooks/use-chat-visibility.ts` | exact alias |
| `@/lib/ai/models` | `src/platform/vendor-compat/lib/ai/models.ts` | exact alias |
| `@/lib/constants` | `src/platform/vendor-compat/lib/constants.ts` | exact alias |
| `@/lib/db/schema` | `src/platform/vendor-compat/lib/db/schema.ts` | exact alias |
| `@/lib/db/queries` | `src/platform/vendor-compat/lib/db/queries.ts` | importer-scoped compat resolver (`vendor/vercel-ai-chatbot/artifacts/actions.ts`) |
| `@/lib/editor/diff` | `src/platform/vendor-compat/lib/editor/diff.ts` | exact alias |
| `@/lib/types` | `src/platform/vendor-compat/lib/types.ts` | exact alias |
| `@/lib/utils` | `src/platform/vendor-compat/lib/utils.ts` | exact alias |
| `shiki` | `src/platform/vendor-compat/shiki.ts` | importer-scoped compat resolver (`vendor/vercel-ai-chatbot/components/ai-elements/code-block.tsx`) |

补充说明：

- `src/platform/vendor-compat/request-init-extensions.d.ts` 仍然是允许存在的 type-only compatibility shim，但它不是 exact import specifier seam owner
- policy 规则继续看 [public-chat-web-donor-diff-whitelist.md](/home/reptilian/code/campus-agent/docs/reference/public-chat-web-donor-diff-whitelist.md)

## Historical Debt

本文 inventory 中不再保留“以后再收”的 donor diff。

- historical debt 路径：`none`
- 如果后续新增路径，必须先回到 `accepted product diff` 或 `accepted runtime compatibility diff` 的明确分类；否则视为 blocker

## Gate

分类由以下 gate 固定：

- [public-chat-donor-diff-classification.test.ts](/home/reptilian/code/campus-agent/apps/public-chat-web/test/public-chat-donor-diff-classification.test.ts)
- [public-chat-donor-diff-whitelist.test.ts](/home/reptilian/code/campus-agent/apps/public-chat-web/test/public-chat-donor-diff-whitelist.test.ts)
- [chatbot-vendor-runtime-parity.test.ts](/home/reptilian/code/campus-agent/apps/public-chat-web/test/chatbot-vendor-runtime-parity.test.ts)

## 相关文件

- [public-chat-web-donor-diff-whitelist.md](/home/reptilian/code/campus-agent/docs/reference/public-chat-web-donor-diff-whitelist.md)
- [public-chat-web-strict-donor-parity-gap-inventory.md](/home/reptilian/code/campus-agent/docs/reference/public-chat-web-strict-donor-parity-gap-inventory.md)
- [public-chat-web-vendor-tech-debt-convergence.md](/home/reptilian/code/campus-agent/docs/plans/public-chat-web-vendor-tech-debt-convergence.md)
