# Agent Note: 会话错误降级、主题跨子域同步与搜索修复

Status: implemented

## 背景

- Issue #601/#606：认证会话查询被全局 Better Auth 限流覆盖（`max: 10, window: 60`），
  `get-session` 返回 429 后客户端错误态粘住，刷新无效；错误页手动重试再次触发限流。
- Issue #603：状态页是独立子域应用，`localStorage` 按 origin 隔离，主题无法同步。
- Issue #602：搜索弹窗垂直居中，移动端软键盘弹出后搜索框被遮挡。
- Issue #605：搜索响应缺少运行时 shape 校验，异常数据导致 `results.map is not a function`
  且无法重试。

## 决策

- 认证限流：better-auth `rateLimit.customRules` 显式豁免 `/get-session`；Campus Web
  把「有缓存会话数据 + 刷新错误」降级保持 `authenticated` 而非 `unavailable`；
  `SessionUnavailable` 页增加 5 秒自动重试。三层各自独立有效。
- 主题同步：Cookie 为跨子域权威渠道（有效 Cookie 优先于 localStorage），写入时同写两者；
  非 IP/localhost 域使用 `domain=.{父域}`，IP/localhost 用 host-only。bootstrap 与
  `ThemeProvider` 读取优先级一致，`syncCookie` 为显式 opt-in。ops-web 的 bootstrap 副本受
  `ui-foundation` 合同约束与共享源字节级一致，读侧因此同样 Cookie 优先，ops-web 同步启用
  `syncCookie` 使写侧对齐；campus-web docs 入口未开启，与主站同源共享 localStorage，不受影响。
- 搜索：客户端校验 `conversations` 为数组，异常 shape 转为可重试的 `ApiRequestError`。
- 弹窗：移动端 `top-4 translate-y-0` 顶部锚定，`sm` 及以上恢复垂直居中。

## 未采用方案

- 全局提高认证限流阈值：会同时削弱登录/注册等写操作保护，且不能解决只读查询被限流的本质。
- `postMessage` / `BroadcastChannel` 同步主题：要求两个应用同时打开，首次访问仍不同步；
  Cookie 在子域间天然共享。
- 服务端主题偏好存储：状态页为静态应用，无会话/存储依赖；主题是无状态 UI 偏好。
- 搜索面板组件级 ErrorBoundary：已有 `ApiRequestError` 可重试路径，在数据边界做 shape 校验
  更早拦截且保持语义一致。

## 后果

- `auth-session` 测试语义更新（error + data → authenticated）；`packages/ui` 新增 Cookie
  同步用例；`status-web` DOM 测试断言 Cookie 写读；e2e 新增移动端弹窗锚定用例；
  `app-api` 断言 `customRules` 形状。
- 桌面端 `qa` 搜索 e2e 回归通过；移动端新用例通过。
- 覆盖缺口：限流豁免仅在部署环境启用，本地单测断言配置形状；跨子域 `domain` 属性在
  本地 IP 环境退化为 host-only，真实 `.muc.wiki` 共享由部署验证。
- 共享源变更后 ops-web 副本曾漏同步，由 CI `ops-web#test:dom:fast`（bootstrap 对齐断言）
  拦截后同批修复。
