# Agent Note: 在线对话运行态 UI 缺陷修复与死代码清理

Status: implemented

## 背景

按运行状态逐项核对浏览器渲染与 [产品状态合同](../../../../docs/product/campus-ui-state.md) 后发现四组缺陷：

- 检索阶段 assistant-ui external-store runtime 因 `hasUpcomingMessage` 追加乐观空 assistant 消息，
  渲染成裸 `●` 指示符，违反"首个 answer.delta 前不出现正文"的合同。
- 运行状态行放在滚动视口内，消息增长时反复进出视口造成布局跳动，且与 composer dock 双重 padding。
- 短回答完成时 top-anchor reserve 同步拆除使视口被瞬时 clamp 上跳（实测约 386px）。
- `request.cancelled` 终态被前端提前 return，跳过 canonical 投影：后端已持久化的 assistant error
  消息不落地、错误码丢失、取消消息显示通用"回答失败"文案且仍暴露"重试"入口（后端标记 retryable=false）。

## 决策

- 指示符与占位：`MessagePrimitive.GroupedParts` 传 `indicator="never"`（aui 0.3.18 公开 prop），
  footer 容器改 `empty:hidden` 并去掉 `min-h-6`；`ActionBarPrimitive.Root` 与
  `BranchPickerPrimitive.Root` 隐藏时渲染 null，故 footer 不再占位。
- 状态行移入 composer dock 内层列（`ThreadScrollToBottom` 之前），状态 `<p>` 只保留
  `aui-thread-run-status text-sm`，由 dock 容器统一 max-width 与 padding，选择器 `.aui-thread-run-status` 不变。
- 完成滚动：viewport 内挂 `ThreadCompletionScroll`（渲染 null），用 `useThreadViewportStore`
  的 `scrollToBottom({ behavior: "smooth" })`，仅在 isRunning true→false 且末条 assistant
  非 error 时触发；错误/取消终态保留用户阅读位置。复用 aui 的 followBottom 逻辑，
  跨 reserve 拆除由 `useThreadViewportAutoScroll` 的 resize 重发保持平滑。
- 取消终态：terminal handler 不再对 `request.cancelled` 提前 return；`request.failed`/`request.cancelled`
  的 `data.error` 以 `terminalError` 传入 `toAssistantThreadMessages`，按 requestId 匹配后本地化文案，
  并把 `errorCode` 写入 message metadata（`custom.campusMessage.errorCode`）。
  `AssistantMessageStatus` 对 `errorCode === "execution_cancelled"` 返回 null（文案已表达取消，不重复标签）。
  `ReloadAction` 在 `retryable === false` 时返回 null，隐藏"重试/重新生成"。

## 未采用方案

- patch node_modules 把 reserve 拆除做成动画：teardown 与 `setReserveHeight(0); remove()` 在同一同步块，
  无公开钩子；clamp 后终态（完整回答落于视口底部）本身正确，接受短回答场景的瞬时跳变。
- 为 `ChatMessage` 持久化 errorCode 列：只为刷新路径的文案恢复引入持久化字段，超出本次完成条件；
  刷新后取消消息回退通用文案，作为已知限制。
- 前端自建滚动监听或定时器驱动完成滚动：与 aui viewport store 的 followBottom 竞态，
  改为复用其 `scrollToBottom`。

## 后果

- 验证：`tsc --noEmit`、biome check、campus-web 全量 vitest 通过；
  E2E qa（含取消用例新增断言：取消文案可见、无状态标签、无重试按钮、状态行消失）、
  message-actions、conversation-lifecycle、conversation-actions、accessibility 全部通过。
- `request.failed` 走同一 terminalError 机制，失败终态文案同样按 code 本地化。
- 已知边界：短回答完成时仍有瞬时 clamp（终态正确）；本地 fetch 失败路径的 local error 消息
  无 errorCode，继续显示通用文案；刷新后取消消息无专用文案。

---

## 背景：一致性清理与死代码移除

同批全量扫描发现五组交互/一致性缺陷与两条死代码路径：

- 会话删除无二次确认，误点即不可逆丢失整段对话。
- 空会话欢迎语贴顶（容器无 `flex-1`），与新设计稿"垂直居中"不符。
- markdown 懒加载组件无渲染错误边界：remark/citation 插件抛错会冒泡炸掉整条消息列表。
- "恢复连接"为裸 `<button>`（无焦点环、热区小）；停止生成用手写 `Button`+after 伪元素，
  与发送/语音按钮的 `TooltipIconButton` 模式不一致；会话列表"更多操作"热区仅 28px。
- `reasoning.tsx` 与 `ThreadSuggestions` 为死代码：后端从不产生 reasoning parts，
  suggestions 无任何 provider 注入（E2E 中"国家奖学金"等按钮实为会话列表标题），
  治理测试明确禁止暴露思维链。

## 决策：交互一致性与清理

- 删除确认：`thread-list.tsx` 引入 `@campus-agent/ui` 的 `ConfirmDialog`（AlertDialog 语义），
  删除项 `onSelect` 不调 `event.preventDefault()`，让下拉菜单自然关闭后再开确认框；
  归档项保留 preventDefault（维持原有"操作后菜单不闪关"行为）。
- 欢迎语居中：viewport 内容容器加 `flex-1`，配合既有 `justify-center`（仅空会话）实现垂直居中。
- markdown 边界：`lazy-markdown-text.tsx` 新增 `MarkdownTextErrorBoundary`
  （`getDerivedStateFromError` + 以 `resetKey` 比较实现按 text part 内容重试），
  `thread-message.tsx` 传 `resetKey={part.text}`，流式续写时自动重试渲染。
- 一致性：恢复连接改 `Button variant="link" size="sm"`（获得统一焦点环与热区）；
  停止生成改 `TooltipIconButton`（对齐发送按钮，含 tooltip 与 after 热区）；
  列表"更多操作"补 `relative after:absolute after:-inset-1 after:content-['']` 热区。
- 死代码移除：删除 `reasoning.tsx`、`ThreadComponents.ReasoningGroup`、
  `groupBy` 的 reasoning 键与 `case "reasoning"`、`--chat-reasoning-fade` token、
  `ThreadSuggestions` 及其在 `thread.tsx` 的挂载；`thread-message.tsx` 移除无消费者的
  `useContext(ThreadSettingsContext)`；`thread-actions.tsx` 移除父容器非 grid 的
  `col-start-3 row-start-2`。
- 测试同步：governance 测试删去 reasoning 源码断言；qa-interactions 删除用例补"确认删除"步骤；
  新增 E2E `asks for confirmation before deleting a conversation`（取消不发 DELETE、确认后列表刷新）
  与单测 `test/lazy-markdown-text.boundary.test.tsx`（fallback、resetKey 恢复、同 key 不恢复）。

## 未采用方案：删除确认与 markdown 边界

- 删除确认用 window.confirm：与仓库既有 `ConfirmDialog`/AlertDialog 语义重复且不可样式化。
- ErrorBoundary 按 message id 重置：text part 粒度的 `resetKey` 已足够，且流式续写即内容变更。

## 后果：验证与测试同步

- 验证：`tsc --noEmit --checkers 1`、biome check、campus-web 全量 vitest（118 文件 898 用例）通过；
  E2E conversation-actions（4）、message-actions、qa、chat（合计 16）、conversation-lifecycle、
  ui-baseline、accessibility（合计 9）全部通过。
- 真实浏览器复核：欢迎语垂直居中（桌面中心差 0px、390px 差 2px）、删除确认开合正常
  （取消后会话保留、菜单关闭、pointer-events 恢复）、390px 抽屉 260px 内菜单与对话框均不溢出视口。
- E2E 曾出现"取消后 `<html>` 拦截 pointer events"假失败，根因即删除项 preventDefault
  保持菜单打开；随菜单自然关闭修复一并消除，测试中另加 `waitForFunction(pointerEvents !== "none")` 防御。
- dev 栈一次回答失败为后端会话/上游问题（`session_required`），与本次 UI 改动无关。

---

## 背景：docs-search-dialog 测试在 isolate:false 下的顺序敏感

提交本批改动触发 prek affected-pre-commit 时，`campus-web:test:dom:fast` 曾以
`ReferenceError: Worker is not defined`（`docs-search-dialog.tsx` 经真实
`loadDocsSearchClient` 走到 `new Worker`）连续失败 9 例；同状态重跑又通过，
在 HEAD（不含本批改动）也可复现，属预存 flaky。

## 决策：测试注入修复

- 根因：`campus-dom-fast` 项目 `isolate: false` + `maxWorkers: 1`，全部文件共享模块缓存与
  jsdom 环境；`docs-search-dialog.test.tsx` 仅靠 hoisted `vi.mock("@/features/docs/search-client")`
  屏蔽真实 client。前序文件一旦以真实绑定缓存组件模块，后到的 mock 无法回溯替换，
  是否失败取决于当次文件执行顺序。
- 修复：组件本就暴露 `searchRuntime` 注入 seam（`load`/`reset`），测试改为在
  `renderSearchPanel` 直接传 `searchRuntime={{ load: () => searchClientMock, reset: searchClientMock.reset }}`，
  不再依赖模块 mock 的应用时序；vi.mock 保留作兜底。
- 拆分提交时按 hunk 重建中间态（thread.tsx/thread-message.tsx 跨
  运行态、boundary、controls、死代码移除四个提交），每个提交态均过
  typecheck + fast/isolated vitest 后再走 prek。
