# Agent Note: 页面内反馈面板

Status: implemented

## 背景

用户从食堂或地图页面提交反馈时，会被导航到 `/feedback?source=dining`，离开当前任务。
提交的 `routeContext` 是 `/feedback?source=…`，无法记录具体的食堂、楼层、窗口或地图选择，
收到反馈的人不知道用户指的是哪个位置。

分类也不根据来源预选：从食堂进入时，分类仍默认"内容问题"，用户得手动改成"食堂问题"。

## 决策

1. **抽出通用表单 `FeedbackForm`**，接受 `routeContext`、`sourceLabel`、`defaultCategory` 和可选的 `onDone`。
   `/feedback` 页面改为外层容器加这个表单，继续从 URL `?source=` 读取并在首次进入时固定。
2. **新增 `FeedbackSheet`**：居中 `Dialog`（`@campus-agent/ui` 的 `DialogContent`），桌面与移动同形态。
   打开时记录 `window.location.pathname + search` 作为 `routeContext`，面板存续期间不改写。
   面板状态不写进 URL，关闭时表单随面板卸载。
3. **食堂"信息有误？反馈"和加载失败的"反馈"按钮**改为原地打开面板，预选"食堂问题"。
   来源显示 `食堂地图 · 食堂 · 楼层 · 窗口`；没选窗口时只到楼层。
4. **地图加载失败的"反馈"按钮**改为原地打开面板，预选"地图问题"，来源显示"校园地图"。
5. **协议页的反馈入口删除**。协议页是纯阅读页，不需要记录具体位置；产品导航里的"反馈"保持跳转 `/feedback`。
6. **登录用户默认匿名提交**：`FeedbackForm` 接受 `sessionContact`（账号邮箱），传入时用手填框换成
   默认勾选的"匿名提交" Checkbox（提交 `contact: null`，附"不会附带你的账号联系方式"提示）。
   取消勾选后展示预填账号邮箱的可编辑联系方式框——校园邮箱仅作身份验证方式，不是长期联系方式要求，
   可改成其他邮箱或留空（复用食堂评价的匿名 Checkbox 模式）。匿名访客保持原手填框。
   身份来自 `useCampusSession`，不额外请求。
   后端 `submitFeedback` 目前是无持久化占位实现，`contact` 校验后即丢弃；待反馈持久化落地时再评估
   后端直接绑定会话身份（届时前端可停传 contact）。
7. **`AdaptiveSheetSurface` 留在 `components/dining/`**。它是食堂弹层（投稿、评价、窗口投稿列表）的
   专用外壳——移动端底部 Drawer 对应"浏览内容"的交互模式；反馈是提交动作，产品要求体验对齐
   餐饮点评软件的提评价感，用居中 Dialog，不复用该外壳。

## 未采用方案

- **反馈复用 `AdaptiveSheetSurface`（桌面侧 Sheet / 移动底部 Drawer）**：初版实现确实走了这条路，
  产品评审否决——底部抽屉是浏览型弹层的形态，反馈应与点评类 App 的提交体验一致，改为居中 Dialog。
- **把面板状态写进 URL**：反馈很短，不需要分享或刷新后恢复；代价是手机上按返回键不会关闭面板，
  只能按 Esc 或点关闭。产品判断不值得为反馈面板新增一层 URL 状态。
- **关闭前确认放弃草稿**：普通反馈不是长文写作，且没有附件上传，误关成本低，不需要二次确认。
- **把反馈的浏览器用例留在 Playwright e2e**：`e2e.config.ts` 的 `webServer` 在 dev profile 的
  `campusWeb` 端口上启动 `vite preview`（`reuseExistingServer: false`，当前 slot 是 27314），
  与 `pnpm dev` 的 Vite 开发服务器互斥，跑测试前必须先停 dev。反馈用例只覆盖单页面交互，
  不值得占用这个需要停机的位置。

## 后果

- **正面**：
  - 反馈不再打断当前任务，用户可以边看边填；
  - `routeContext` 记录真实位置（例如 `/dining?hall=…&floor=…&window=…`），收到反馈的人能直接定位；
  - 分类根据来源预选，减少用户操作；
  - 居中 Dialog 一处形态覆盖所有断点，移动端叠在食堂详情面板之上；
  - 反馈的浏览器用例迁到 `test/browser`，与 dev 服务器可同时运行。
- **需要注意**：
  - 面板状态不在 URL，手机用户不能用返回键关闭；
  - 协议页不再提供反馈入口，需要从产品导航进入；
  - 新增 `onOpenFeedback` 回调，食堂和地图页需要维护 `feedbackOpen` 状态；
  - 食堂弹层外壳与反馈弹窗从此是两套形态，新增弹层时须按"浏览 vs 提交"对号入座。

## 浏览器测试归属

反馈的浏览器行为由 `test:browser`（Vitest Browser Mode，`test/**/*.browser.test.tsx`）覆盖。
它由 Vitest provider 在独立端口启动测试服务器，与 dev 的 27314 不冲突，因此可以在 `pnpm dev` 运行时执行。

Browser Mode 的 `page` 只有 `viewport`/`screenshot`/`locator`，没有 `goto` 和 `route`，不能做导航和
网络拦截；因此用例按组件渲染来写（`render(<FeedbackSheet … />)`，用 `vi.mock` 替换
`features/feedback/api`）。`routeContext` 读取的 `window.location` 用 `history.replaceState` 设置后仍是真实值。

分工：真实 DOM 下的表单交互、弹层形态（居中几何、不出现 vaul Drawer）归 Browser Mode；
跨页面导航、网络拦截和真实构建产物边界继续留在 Playwright e2e。

食堂的真实接线（`DiningPageContent` 的 `feedbackOpen` 状态、`feedbackLabel()` 来源、原地打开不改路由）
由 `dining-navigation.isolated.test.tsx` 在真实路由 harness 上覆盖；Browser Mode 只负责 jsdom 无法验证的
布局形态，不复刻接线。

`test:browser` 复用 turbo.json 中既有的同名任务（`cache: false`），且不加入根 `test` 聚合任务，
与"浏览器回归是本地、按需的可选证据"一致；[本地验证手册](../../../../docs/runbooks/local-verification.md)
的浏览器回归一节记录了这两个入口。

## 覆盖缺口

故意不复刻接线。初始版本的 `dining-feedback.browser.test.tsx` 直接渲染 `DiningPageView`、自己拼
`sourceLabel` 并自己维护 `open`，等于把 `DiningPageContent` 的接线抄了一份；真实接线坏掉时它仍会通过。
该用例已改为只验证弹层形态布局，接线由真实路由 harness 的用例承接。

路由用例用 `createMemoryHistory`，不会写 `window.location`，所以用例先 `history.replaceState` 到同一路由，
面板读到的 `routeContext` 才是真实值。

## 相关文档

- [Campus Web 产品规则](../../../../docs/product/web.md) — `routeContext` 记录规则已更新
- [食堂地图产品文档](../../../../docs/product/dining.md) — 补充反馈入口说明
- [食堂页面布局、视觉、搜索与移动端详情](./2026-10-18-dining-page-polish.md) — 本次反馈改动与布局改动在同一分支
