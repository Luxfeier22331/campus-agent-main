---
phase: "F"
name: "Public Auth Shell Productization"
created: 2026-04-19
updated: 2026-04-19
status: completed
---

# Phase F Context

## Goal

把 `public-chat-web` 的 `/login` `/register` 从“运行上存在、治理上灰区”的入口，冻结成正式 public auth family 的前两条 route，并为 `Phase G/H/I` 的 forgot/reset password 留出同壳扩展位。

## Current Truth

- `apps/app-api` 已是 canonical auth / session / principal owner；public chat 只能消费 same-site `/api/auth/*` 与 session projection。
- `apps/public-chat-web` 当前 `/login` `/register` 已直接复用 donor `AuthLayout` / `AuthForm` 可见壳，repo-owned 差异集中在 `src/login/`、`src/routes/`、`src/platform/auth/` 与 `src/platform/vendor-compat/`。
- `src/platform/vendor-compat/next-auth/*` 已证明当前姿势是“保留 donor 可见语言 + 用 compat seam 接本地 runtime”，不是把 donor `Auth.js` runtime 带回主线。
- `docs/reference/public-chat-web-route-state-parity-inventory.md` 先前残留 `out-of-scope` 旧口径；本轮 planning 已把它收口成正式受管 auth surface。
- `protected-panel-web` 已明确不拥有 self-serve signup、password reset 或 profile management；它的 `/login` 继续只是 Cloudflare Access reentry。
- `app_auth.verification` 已存在，可作为 `Phase G` reset token contract 的 schema 基础，但当前没有 reset callback 与 auth mail provider truth。

## Locked Decisions

### Auth Surface Owner

- visible auth shell owner 固定为 donor `AuthLayout` / `AuthForm` 语言。
- repo 不再新造一套 repo-owned login / register 视觉体系。
- `protected-panel-web` `/login` 继续只是 Cloudflare Access reentry，不并入 end-user password product。

### Runtime Boundary

- canonical auth truth 固定在 `apps/app-api` Better Auth。
- `public-chat-web` 继续只通过 same-site `/api/auth/*`、`better-auth/react` client 与 compat `next-auth` seam 接 runtime，不导入 donor `Auth.js` / `Next.js` auth runtime。
- future forgot/reset 也必须沿用同一 auth family 与 same-site seam。

### Route Family And State Contract

- `/login`、`/register`、future `/forgot-password`、future `/reset-password` 属于同一 public auth family。
- `/login` 与 `/register` 继续在 authenticated hit 或 success 后 redirect 到 `/chat`。
- future recovery flow 完成后默认回 `/login` 或显式 success state，不直接跳 `protected-panel-web` 或其他 surface。

### Allowed Repo-Owned Diffs

- 允许差异只限于 institution/product copy、route bootstrap/redirect semantics、same-site action adapter、vendor compat seam 与 recovery CTA placement。
- 不允许把 donor visible shell 拆回 repo 自写 form structure、local visual mode switch 或另一套 auth chrome。

### the agent's Discretion

- 具体 copy 语气、CTA 文案与局部 spacing/icon small diffs 可在后续执行时决定，但不能改写 visible owner 与 shell structure。

## Existing Code Insights

### Reusable Assets

- `apps/public-chat-web/src/login/page.tsx`：现有 donor sign-in shell wrapper。
- `apps/public-chat-web/src/login/register-page.tsx`：现有 donor register shell wrapper。
- `apps/public-chat-web/vendor/vercel-ai-chatbot/app/(auth)/layout.tsx`：当前 active auth family layout。
- `apps/public-chat-web/vendor/vercel-ai-chatbot/components/chat/auth-form.tsx`：当前 active auth form structure。

### Established Patterns

- `apps/public-chat-web/src/platform/auth/client.ts` 已通过 `better-auth/react` 消费 same-site auth endpoints。
- `apps/public-chat-web/src/platform/vendor-compat/next-auth/react.tsx` 已把 donor `useSession` / `signOut` 接到 `ChatbotShellRuntimeContext`。
- `apps/public-chat-web/test/public-chat-auth-regressions.test.ts` 已锁定 donor auth shell 与 compat seam 不被回退。
- `apps/public-chat-web/test/worker.test.ts` 已锁定 `/api/auth/*` 继续转发 `Origin` / `Referer`。

### Integration Points

- `apps/app-api/src/modules/auth/auth.ts`：current Better Auth owner，future reset backend entry。
- `apps/app-api/src/db/schema/auth.ts`：`app_auth.verification` table 已可承接 reset token contract。
- `docs/reference/public-chat-web-route-state-parity-inventory.md`：需要改成 formal auth surface wording。
- `docs/environment/provider-and-secret-inventory.md`：`Phase G` mail provider / secret truth 落点。

## Canonical References

- `docs/architecture/identity-and-authorization-architecture.md` — `app-api` 是 canonical auth / session owner。
- `docs/architecture/product-runtime-architecture.md` — public/protected surface responsibilities。
- `apps/public-chat-web/README.md` — 当前 public chat runtime 与 auth shell seam。
- `apps/protected-panel-web/README.md` — panel auth non-goals。
- `docs/plans/archive/completed/shared-product-surfaces-acceptance-hardening.md` — workstream-native phase boundary。
- `.planning/workstreams/shared-product-surfaces-acceptance-hardening/REQUIREMENTS.md` — current success criteria。
- `.planning/workstreams/shared-product-surfaces-acceptance-hardening/ROADMAP.md` — phase order and dependencies。
- `.planning/workstreams/shared-product-surfaces-acceptance-hardening/STATE.md` — current blockers and verification truth。
- `docs/reference/public-chat-web-route-state-parity-inventory.md` — public auth family route inventory。

## Deferred Ideas

- social login、magic link、MFA、profile management、panel account recovery 都不属于本 phase。

## Entry

- `docs/plans/archive/completed/shared-product-surfaces-acceptance-hardening.md`
