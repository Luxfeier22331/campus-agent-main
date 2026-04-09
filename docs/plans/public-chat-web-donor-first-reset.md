---
doc_type: plan
status: completed
created: 2026-04-08
updated: 2026-04-09
---

# Public Chat Web Donor-First Reset

## 文档边界

本文只负责 `apps/public-chat-web` 的 donor frontend 纠偏与迁移计划。

状态更新：

- 本文描述的 donor-first reset 已完成其前向目标
- 当前 runtime 已进一步收口到 `vendor/vercel-ai-chatbot/` + `src/platform/` + `src/routes/` + `src/login/`
- `src/chatbot-donor/`、`src/chatbot-shell/` 与 `src/public-chat/auth.ts` 都已从 app source tree 退役
- 当前后续工作应以
  [public-chat-web-vendor-runtime-full-transplant.md](/home/reptilian/code/campus-agent/docs/plans/public-chat-web-vendor-runtime-full-transplant.md)
  为准

本文回答的是：

- 为什么此前的 `src/chatbot-shell/` 路线不再作为 forward implementation
- 当前 donor frontend 应如何在 repo 内落地
- donor frontend runtime 现在由哪些目录组成
- 后续还剩哪些收口工作

本文不负责：

- 改写 `public-chat-web -> app-api -> supervisor-api` 主链路
- 把 upstream backend、auth、storage 或 deployment 方案带进 repo
- 在这轮同时引入 streaming、attachments、artifacts pane、model selector

## 直接结论

当前 `public-chat-web` 的 forward 纠偏策略已经明确为：

`vendor full donor frontend, then adapt edges`

而不是：

- `adapt shell, then keep rewriting it`

补充说明：

- `vendor + overlay` 是当前 worktree 的运行现状，不是目标终态
- 下一轮详细实施应以
  [public-chat-web-vendor-runtime-full-transplant.md](/home/reptilian/code/campus-agent/docs/plans/public-chat-web-vendor-runtime-full-transplant.md)
  为准
- 当前 forward target 已进一步固定为：
  `vendor-owned chat runtime + repo-owned platform seams`

## Canonical 目标

`staging` 上的 `https://campus-chat-staging.ayafeed.com/chat` 应满足：

- 第一眼看上去就是接近 `vercel/chatbot` 的前端壳
- desktop 与 mobile 都保持 donor 的 chat-first shell 气质
- sidebar、thread、composer、empty state、history state 尽量保持 donor 结构和样式节奏
- 本地化只体现在 adapter、auth seam、route integration 和少数产品 copy

允许保留的 repo-local 差异只有：

- Worker runtime shell
- same-site `/api/*` proxy seam
- `app-api`-owned auth/session/conversation/request truth
- `/login` 是 repo-owned 页面
- 当前 campus domain 的有限产品文案

## 当前落地形态

以下小节记录 donor-first reset 完成前后的中间态，用于解释这轮纠偏为何发生。
当前最终状态以前文“状态更新”为准。

2026-04-09 当前 worktree 的 forward runtime 形态已经改成：

- donor vendor tree：
  [apps/public-chat-web/vendor/vercel-ai-chatbot/](/home/reptilian/code/campus-agent/apps/public-chat-web/vendor/vercel-ai-chatbot)
- repo-owned donor compatibility overlay：
  [apps/public-chat-web/src/chatbot-donor/](/home/reptilian/code/campus-agent/apps/public-chat-web/src/chatbot-donor)
- repo-owned login/session/bootstrap surface：
  [apps/public-chat-web/src/public-chat/](/home/reptilian/code/campus-agent/apps/public-chat-web/src/public-chat)
- deprecated transitional shell：
  [apps/public-chat-web/src/chatbot-shell/](/home/reptilian/code/campus-agent/apps/public-chat-web/src/chatbot-shell)

关键实现点：

- `/chat` 与 `/chat/:conversationId` 现在从
  [app-shell.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/src/chatbot-donor/app-shell.tsx)
  进入 donor runtime，而不是继续渲染
  [shell-page.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/src/chatbot-shell/shell-page.tsx)
- donor shell 的主 chrome 现在通过 `@/* -> vendor/vercel-ai-chatbot/*` 直接挂载 vendor source of truth
- repo-owned session/history/chat transport seam 已迁到：
  [src/platform/chat/](/home/reptilian/code/campus-agent/apps/public-chat-web/src/platform/chat)
- repo-owned auth client 已迁到：
  [src/platform/auth/client.ts](/home/reptilian/code/campus-agent/apps/public-chat-web/src/platform/auth/client.ts)
- `src/chatbot-donor/` 当前只保留 app-shell 入口与临时 Next/Auth shims，不再继续承载 repo-owned chat clone 组件
- donor globals 现在由
  [app/globals.css](/home/reptilian/code/campus-agent/apps/public-chat-web/vendor/vercel-ai-chatbot/app/globals.css)
  提供；repo-owned
  [styles.css](/home/reptilian/code/campus-agent/apps/public-chat-web/src/styles.css)
  只保留 login / route status / boot fallback 样式

## 保持不变的边界

- `apps/public-chat-web/src/index.ts` 继续负责 Worker runtime 壳
- same-site `/api/* -> app-api` 继续保持
- `/login` 继续由 repo-owned surface 承担
- browser 不得绕过 `public-chat-web` 直打 `supervisor-api`
- `app-api` 继续拥有 auth/session/conversation/request truth

## 已完成事项

### Phase 1：Freeze And Parity Contract

- donor-first reset plan、route inventory、drift inventory 已落盘
- 团队方向已经从“继续修过渡 shell”切到“完整 donor frontend + vendor-owned runtime with platform seams”
- `src/chatbot-shell/` 已明确降级为 deprecated transitional shell

### Phase 2：Vendor Full Donor Frontend

- donor tree 已落到
  [apps/public-chat-web/vendor/vercel-ai-chatbot/](/home/reptilian/code/campus-agent/apps/public-chat-web/vendor/vercel-ai-chatbot)
- `public-chat-web` 已补上 donor 运行所需 alias / shim / dependency
- donor globals 已进入 runtime build

### Phase 3：Cut Runtime Over To Donor Overlay

- `/chat` 与 `/chat/:conversationId` 已切到 donor overlay runtime
- sidebar / shell / visibility / history / user nav 已切到 donor 直接消费路径
- current unsupported branches 已在 repo-owned compat seam 中 fail-close，而不是继续让 repo-local shell 接管主布局
- `public-chat-web` 当前验证已通过：
  - `pnpm --dir apps/public-chat-web typecheck`
  - `pnpm --dir apps/public-chat-web build`
  - `pnpm --dir apps/public-chat-web test:worker`

## 剩余工作

### 1. vendor runtime ownership 重置

- 需要把 `@/*` ownership 从 `src/chatbot-donor/*` 收回到 `vendor/vercel-ai-chatbot/*`
- 需要停止让 repo-owned chat 可见组件继续占据主路径
- 详细文件级方案见
  [public-chat-web-vendor-runtime-full-transplant.md](/home/reptilian/code/campus-agent/docs/plans/public-chat-web-vendor-runtime-full-transplant.md)

### 2. platform seam 与 route 收口

- 把仍留在 `src/chatbot-shell/` 的 runtime-neutral adapter/context 全部迁到 `src/platform/*`
- 用 TanStack Router 替换当前 BrowserRouter / `react-router-dom` 路径
- 移除 `next/*` 与 `next-auth/*` 的长期 shim 依赖

### 3. unsupported capability parking 与 staging 验收

- `unsupported feature` 当前不做永久切除
- 这些 feature 未来可能重新上线，因此本轮只要求：
  - 不再让 repo-owned fallback UI 接管它们
  - 在文档与接线层面明确其 `parked capability` 状态
  - 如阻塞主壳迁移，只允许从当前 launch path 脱线，不要求删除源码
- 重跑 staging smoke
- 确认 authenticated flow、history rendering、new chat、existing chat、sign out 都符合 donor shell 预期
- 结合截图和 MCP 结果更新 parity checklist

## 验收口径

满足以下条件时，这轮 donor-first reset 才算完成：

- repo 内 runtime 路径明确以 `vendor-owned runtime + platform seams` 为准
- local typecheck / build / worker tests 持续通过
- staging smoke 与 donor parity smoke 给出正向证据
- unsupported capability 的当前状态和未来重开方式都有明确去向，不继续在 runtime 中扩散

### 当前执行状态

2026-04-08 已落地产物：

- runtime context 收敛到 `chatbot-shell`：
  - [runtime.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/src/chatbot-shell/runtime.tsx)
  - 删除旧 [public-chat/context.ts](/home/reptilian/code/campus-agent/apps/public-chat-web/src/public-chat/context.ts)
- `public-chat` bootstrap 改为消费 shell adapter：
  - [app.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/src/public-chat/app.tsx)
  - 现在由 `loadShellSession` / `listShellConversations` 驱动 session 与 history bootstrap
- shell 组件不再自行二次映射 principal / conversation summary：
  - [shell-page.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/src/chatbot-shell/shell-page.tsx)
- route-level loading/error/access-blocked 状态卡收敛为 donor-first 兼容视觉：
  - [styles.css](/home/reptilian/code/campus-agent/apps/public-chat-web/src/styles.css)
- 新增 runtime seam 测试：
  - [chatbot-shell-runtime.test.ts](/home/reptilian/code/campus-agent/apps/public-chat-web/test/chatbot-shell-runtime.test.ts)

本轮完成后，Phase 3 目标中的以下项已满足：

- session adapter 与 conversation adapter 已进入 shell-facing runtime seam
- `public-chat/app.tsx` 不再直接把 raw session/conversation shape 暴露给 shell
- `/chat` 与 `/chat/:conversationId` 的真实运行路径继续保持 donor-first 外观
- Suspense fallback / session loading / access blocked 不再使用 donor-drift copy

本轮验证已通过：

- `git diff --check -- apps/public-chat-web/...`
- `pnpm --dir apps/public-chat-web typecheck`
- `pnpm --dir apps/public-chat-web test:worker`
- `pnpm --dir apps/public-chat-web build`

### 验收清单

- 登录后进入 `/chat` 的真实运行界面仍保持 donor-first 视觉
- history/sidebar 能真实读取 conversation 数据
- existing thread 打开后仍保持 donor 布局
- 首轮提问和后续追问都能工作
- `answer / clarification / no_answer / error` 都能在 donor 风格 UI 内正确显示
- adapter 不再主导 UI 文案和布局

## Phase 4：Cutover And Transitional Shell Retirement

目标：

- 用 donor-first shell 替换当前过渡壳
- 删除不再需要的过渡视觉实现

### 实施清单

- 让默认 `/chat` 与 `/chat/:conversationId` 只指向 donor-first shell
- 清理当前过渡实现中的非必要组件、样式与 copy
- 收缩 `src/public-chat/` 的职责，只保留：
  - `/login`
  - session bootstrap
  - route status card
  - boot fallback
- 删除或归档不再需要的过渡 shell 文件
- 更新 README / runbook / smoke 路径，明确 donor-first shell 才是当前产品主壳

### 当前执行状态

2026-04-09 已落地产物：

- `src/chatbot-shell/` 已从 transitional 标记切到 canonical chat shell：
  - [README.md](/home/reptilian/code/campus-agent/apps/public-chat-web/src/chatbot-shell/README.md)
  - [shell-page.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/src/chatbot-shell/shell-page.tsx)
- app README 已切到 cutover 后真相表述：
  - [apps/public-chat-web/README.md](/home/reptilian/code/campus-agent/apps/public-chat-web/README.md)
- 参考/计划文档已同步去除过时的 transitional 表述：
  - [public-chat-web-route-state-parity-inventory.md](/home/reptilian/code/campus-agent/docs/reference/public-chat-web-route-state-parity-inventory.md)
  - [public-chat-web-chatbot-donor-baseline.md](/home/reptilian/code/campus-agent/docs/reference/public-chat-web-chatbot-donor-baseline.md)
  - [public-chat-web-chatbot-replatform.md](/home/reptilian/code/campus-agent/docs/plans/public-chat-web-chatbot-replatform.md)
- 删除不再需要的 shell barrel：
  - [index.ts](/home/reptilian/code/campus-agent/apps/public-chat-web/src/chatbot-shell/index.ts)

本轮完成后，Phase 4 目标中的以下项已满足：

- runtime path 上不再保留旧 hand-written chat shell
- `src/public-chat/` 的职责已明确收缩到 login、session bootstrap、route gating、route status card
- `src/chatbot-shell/` 被明确记录为唯一 chat UI 主壳
- README 与前向文档不再把当前 chat shell 描述为 transitional baseline

本轮验证已通过：

- `git diff --check -- apps/public-chat-web/... docs/...`
- `pnpm --dir apps/public-chat-web typecheck`
- `pnpm --dir apps/public-chat-web test:worker`
- `pnpm --dir apps/public-chat-web build`

### 验收清单

- runtime path 上不再存在旧的过渡 chat shell
- `src/public-chat/` 不再承担 chat 主界面视觉职责
- `src/chatbot-shell/` 成为唯一 chat UI 主壳
- README 与 plan docs 不再把当前过渡实现描述成可继续扩张的基线

## Phase 5：Visual Gate, Smoke, And Release

目标：

- 让 donor parity 成为真正的 release gate
- 在 staging 上做 desktop/mobile 真实收口

### 实施清单

- 增加 donor parity review checklist
- 增加 desktop 和 mobile 两套 staging smoke
- 补齐以下验收证据：
  - `/login`
  - `/chat` empty state
  - `/chat` existing thread
  - submit in flight
  - answer
  - clarification / no_answer / error
  - sidebar/history
  - sign out
- 记录直连 staging 的浏览器证据，而不是只靠 local preview
- 补充回滚说明：若 donor-first shell 失败，如何只回退前端壳而不影响 `app-api`

### 当前执行状态

2026-04-09 已完成本轮真实 staging smoke、visual gate 复核与 donor shell postfix retest：

- donor parity review checklist 已落盘：
  - [public-chat-web-donor-parity-review-checklist.md](/home/reptilian/code/campus-agent/docs/reference/public-chat-web-donor-parity-review-checklist.md)
- 真实浏览器证据已落盘：
  - 第一轮 gate 基线：
    - [SUMMARY.md](/home/reptilian/code/campus-agent/.tmp/staging-smoke/20260409T002042+0800-public-chat-phase5-release-gate/SUMMARY.md)
  - donor shell postfix retest：
    - [SUMMARY.md](/home/reptilian/code/campus-agent/.tmp/staging-smoke/20260409T005148+0800-public-chat-phase5-postfix-retest/SUMMARY.md)
    - [network-summary.md](/home/reptilian/code/campus-agent/.tmp/staging-smoke/20260409T005148+0800-public-chat-phase5-postfix-retest/network-summary.md)
- 本轮已完成的 current-run 取证包括：
  - `/login`
  - `/chat` empty state
  - `/chat` existing thread
  - submit in flight
  - `answer`
  - `clarification`
  - `no_answer`
  - sidebar/history
  - sign out
  - desktop `1440x900`
  - mobile `390x844`
- same-site `/api/*` seam 当前未退化：
  - `GET /api/me` -> `200`
  - `GET /api/chat/conversations` -> `200`
  - `POST /api/chat/requests` -> `200`
  - `POST /api/auth/sign-out` -> `200`

当前 `Phase 5` 仍未关闭，原因如下：

- donor parity review 已从 `FAIL` 提升为 `PASS`
- 当前轮真实 smoke 仍未复现 typed `error` message card，因此 `clarification / no_answer / error` 的 current-run 三态证据仍未收齐

### 回滚说明

若 donor-first shell 在 staging 上需要回退，只回退 `apps/public-chat-web`：

1. 重新部署最后一个已验证的 `public-chat-web-staging` 版本。
2. 不联动回滚 `apps/app-api`，也不改动当前 `SUPERVISOR_API_BASE_URL`、`APP_API` service binding、secret matrix。
3. 回退后只重新验证：
   - `https://campus-chat-staging.ayafeed.com/healthz`
   - `https://campus-chat-staging.ayafeed.com/readyz`
   - `/login`
   - `/chat`
   - sign in / sign out
4. 如果回退后 same-site `/api/*` 异常，应先判为 `public-chat-web` 与当前 `app-api` seam 不兼容，而不是默认把 `app-api` 一起回退。
5. 只有在 `public-chat-web` 单独回退仍不能恢复基本入口时，才升级为跨 app release incident。

### 验收清单

- staging 上的 `campus-chat-staging` 第一眼接近 donor
- desktop smoke 通过
- mobile smoke 通过
- same-site `/api/*` seam 未退化
- 登录、历史、提问、打开已有会话、退出登录全部通过
- 有真实截图和网络证据支持 cutover 结论

## 全局验收门禁

以下条件必须同时满足，才算这轮纠偏完成：

- `public-chat-web` 不再被判断为“自写 chat UI”
- 默认 `/chat` 在视觉与交互上明显接近 `vercel/chatbot`
- 只有 `/login` 继续明显保留 repo-owned 页面特征
- 运行边界保持：
  - `public-chat-web -> app-api -> supervisor-api`
  - same-site `/api/*`
  - repo-owned auth/session truth
- staging smoke 和真实浏览器证据全部收口

## 当前不纳入本计划

- streaming transport 重构
- attachments / artifacts pane / tool approval UI 的重新上线
- model selector 的重新上线
- open-domain provider 直接暴露
- 重写 `app-api` contract 以适配 upstream backend

## 相关文档

- [public-chat-web-chatbot-replatform.md](/home/reptilian/code/campus-agent/docs/plans/public-chat-web-chatbot-replatform.md)
- [public-chat-web-vendor-runtime-full-transplant.md](/home/reptilian/code/campus-agent/docs/plans/public-chat-web-vendor-runtime-full-transplant.md)
- [public-chat-web-chatbot-donor-baseline.md](/home/reptilian/code/campus-agent/docs/reference/public-chat-web-chatbot-donor-baseline.md)
- [README.md](/home/reptilian/code/campus-agent/apps/public-chat-web/README.md)
- [public-chat-web-donor-parity-review-checklist.md](/home/reptilian/code/campus-agent/docs/reference/public-chat-web-donor-parity-review-checklist.md)
