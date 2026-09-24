# campus-web

学生使用的 React 应用与 Cloudflare Worker，提供问答、账号、文档、通知、地图、食堂和同好群页面。

## 职责

- 组合产品路由、导航、认证界面和领域页面；
- 通过 App API 使用产品接口和账号生命周期；
- 构建并交付公开文档站与校园地图静态资源；
- 展示通知、Dining 和同好群等已发布领域数据；
- 维护浏览器与 Worker 的产品交互和发布配置。

本应用不拥有产品数据库、Agent 编排、知识检索、来源采集或运维页面。

## 内部边界

- Worker 默认入口只组合请求路由；健康检查、App API 代理、静态资源和应用 shell 由各自的平台能力维护；
- Conversation feature 的产品请求、运行状态请求和流协议解析相互分离，对外 API facade 只保留
  稳定调用面；
- 浏览器组件不直接依赖 Worker 入口，telemetry 也不得反向导入入口文件。

Conversation coordinator 对已受理请求的传输断线自动恢复一次，失败后由用户手动重连；先读取原 request
状态，终态加载 canonical 消息，运行中按最后 sequence 续接事件，不重新提交 prompt。此行为解决本地
已观察到的“后台完成但页面断线”，由浏览器 conversation feature 拥有，消费既有 status/events 接口；
仅有手动恢复无法自动收敛该状态。取消、鉴权失败、非法协议和业务终态不触发自动恢复，不增加持久状态。
若产品事件传输改由其他 owner 统一恢复，应删除或重新评估此处的一次恢复逻辑。

## 本地命令

```bash
pnpm dev:init -- --target core
pnpm dev:init -- --target core
pnpm --dir apps/campus-web dev
pnpm test --filter=campus-web
pnpm --dir apps/campus-web build
pnpm typecheck --filter=campus-web
```

根 `pnpm test --filter=campus-web` 运行 Node/DOM 普通组、隔离组和本地 Worker 测试，分别缓存叶任务。
`pnpm build:check --filter=campus-web` 使用本地环境和合成文档内容；生产 `build` 仍读取发布文档，
需要配置文档对象存储。完整 E2E 构建一次 fixture，独立套件自行准备构建。
只有需要模块 mock 的测试使用 `.isolated.test.*`；公共 setup 在每个测试后恢复环境和清理 DOM。

`style-dev.html` 是独立的本地组件展示入口。运行 `pnpm dev:init -- --target core` 后访问 `/style-dev.html#overview`，
目录按组件族列出真实组件和真实组合组件；详情页一次只挂载当前示例。示例可以通过
`/style-dev.html#style-dev-conversation-thread/messages` 这样的 hash 直接打开，搜索只作用于本地目录。

当前目录覆盖基础与主题、表单与控件、浮层、问答、文档、地图、食堂和账号。展示页只提供最小真实容器、
内存适配器和静态合同数据，不导入产品路由、领域 API 或提交函数，也不会进入 app 生产构建。

组件行为测试由 Vitest 负责；浏览器 MCP 仅用于本地人工评审，不维护 style-dev 专用 Playwright 验证入口。

完整产品开发使用根 `pnpm dev`。文档来源维护使用 `docs-source/` 声明、`docs:source:check` 与 `docs:source:publish`；
来源合同、构建输入、缓存目录和交付行为由文档站架构、合同和可执行脚本维护。

## 相关文档

- `docs/product/web.md`
- `docs/product/campus-ui-state.md`
- `docs/product/ui.md`
- `docs/architecture/system/product-runtime.md`
- `docs/architecture/system/document-site.md`
- `docs/architecture/system/identity-authz.md`
- `docs/runbooks/local-verification.md`
