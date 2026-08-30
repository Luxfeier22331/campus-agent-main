# campus-web

学生使用的 React 应用与 Cloudflare Worker，提供问答、账号、文档、通知、地图、食堂和同好群页面。

## 职责

- 组合产品路由、导航、认证界面和领域页面；
- 通过 App API 使用产品接口和账号生命周期；
- 构建并交付公开文档站与校园地图静态资源；
- 展示通知、Dining 和同好群等已发布领域数据；
- 维护浏览器与 Worker 的错误和性能接入。

本应用不拥有产品数据库、Agent 编排、知识检索、来源采集或运维页面。

## 内部边界

- Worker 默认入口只组合 Sentry 与请求路由；健康检查、App API 代理、静态资源和应用 shell 由各自
  的平台能力维护；
- Conversation feature 的产品请求、运行状态请求和流协议解析相互分离，对外 API facade 只保留
  稳定调用面；
- 浏览器组件不直接依赖 Worker 入口，telemetry 也不得反向导入入口文件。

## 本地命令

```bash
pnpm dev:shared-reconcile
pnpm dev:init -- --target core
pnpm --dir apps/campus-web dev
pnpm --dir apps/campus-web test
pnpm --dir apps/campus-web test:e2e:smoke
pnpm --dir apps/campus-web build
pnpm --dir apps/campus-web typecheck
```

`style-dev.html` 是独立的本地组件展示入口。运行 `pnpm dev:init -- --target core` 后访问 `/style-dev.html#overview`，
目录按组件族列出真实组件和真实组合组件；详情页一次只挂载当前示例。示例可以通过
`/style-dev.html#style-dev-conversation-thread/messages` 这样的 hash 直接打开，搜索只作用于本地目录。

当前目录覆盖基础与主题、表单与控件、浮层、问答、文档、地图、食堂和账号。展示页只提供最小真实容器、
内存适配器和静态合同数据，不导入产品路由、领域 API 或提交函数，也不会进入 app 生产构建。

组件行为测试由 Vitest 负责；浏览器 MCP 仅用于本地人工评审，不维护 style-dev 专用 Playwright 验证入口。

完整产品开发使用根 `pnpm dev`。文档来源维护使用应用现有的 `docs:source:update`；
来源合同、构建输入、缓存目录和交付行为由文档站架构、合同和可执行脚本维护。

## 相关文档

- `docs/product/web.md`
- `docs/product/campus-ui-state.md`
- `docs/product/ui.md`
- `docs/architecture/system/product-runtime.md`
- `docs/architecture/system/document-site.md`
- `docs/architecture/system/identity-authz.md`
- `docs/runbooks/local-verification.md`
