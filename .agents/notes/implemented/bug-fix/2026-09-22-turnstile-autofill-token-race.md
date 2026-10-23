# Agent Note: Turnstile 自动填充提交的 token 竞态

Status: implemented

## 背景

登录表单在浏览器自动填充凭据后可能立即提交。Turnstile 默认使用 `execution: "render"`，
渲染后异步完成验证；`CampusCaptcha.getToken()` 之前只同步读取一次 `getResponse()`，
因此在 token 尚未产生时直接返回空值，登录显示“安全验证还没有完成”。手动输入凭据通常给验证
更多完成时间，所以不会稳定复现该问题。

## 决策

保留现有 `render` 与 `interaction-only` 运行时配置，以及 `x-captcha-response` 请求合同。
`CampusCaptcha.getToken()` 先复用已生成的 token；没有 token 时使用 Turnstile 实例已有的
`getResponsePromise(30_000)` 等待异步验证结果。仅在配置为 `execution: "execute"` 时先调用
`execute()`，然后使用同一等待路径。等待失败或超时返回空值，继续由现有认证表单错误处理；提交完成后
继续调用现有 `reset()`。

## 未采用方案

- **把默认 execution 改成 `execute`**：需要改变运行时行为和显式执行时机，不能解决当前 `render`
  模式下已观察到的等待竞态，因此保留现有配置。
- **增加新的用户提示或手动验证按钮**：现有流程已经有缺少 token 的错误处理，问题是等待时机而不是
  缺少交互能力；新增提示会扩大当前用户流程。
- **修改认证 API 或请求头合同**：请求只需在 token 就绪后发送，现有 `x-captcha-response` 已满足
  服务端消费者。

## 后果

自动填充后立即提交会等待 Turnstile 自动产生 token，再发送登录请求；已有 token 仍立即复用。
登录、注册、找回密码、账号密码变更和会话重新验证等共用 `CampusCaptcha` 的流程统一获得相同
修复。组件测试覆盖已有 token、`render`/`execute` 异步等待、失败返回空值和无 site key；认证回归
测试覆盖自动填充式立即提交、token 到达前不发送请求、成功后携带 token 并重置组件。
