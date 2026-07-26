# campus-web

学生使用的 React 应用与 Cloudflare Worker，提供问答、账号、文档、地图、食堂、同好群和校园服务页面。

## 职责

- 组合产品路由、共享导航、认证界面和领域页面；
- 通过 Service Binding 或配置的来源调用 app-api；
- 在 `/docs/*` 构建和交付 Rspress 阅读器；
- 按明确 Dining release 加载完整地图和不可变 SVG 资源；
- 维护浏览器与 Worker 的错误、日志和调用链接入。

本应用不拥有产品数据库、Agent 编排、知识检索、文档发布或运维页面。

## 界面实现

- `@campus-agent/ui` 提供仓库语义 Token 和跨应用基础控件；
- `src/design/tokens.css` 只维护页面布局、问答、文档、地图和 Dining 等应用 Token；
- `src/components/ui/` 只维护 Campus 专属组合控件和共享状态；
- `src/styles.css` 与 `theme/docs-ui.css` 只适配应用和 Rspress；
- assistant-ui 负责问答交互，Better Auth UI 与 HeroUI 负责账号界面，Rspress 负责文档阅读；
- 普通共享控件使用仓库的 shadcn/Radix wrapper，单场景展示优先使用语义 HTML；
- `src/components/ui/motion.tsx` 统一共享交互动效并处理 reduced motion；
- `SurfaceState` 用于区域级读取、空状态、错误和降级状态。

页面布局分为阅读、表单、工作区和沉浸式四类，具体组件尺寸与样式由 Token、组件和测试维护，不在
产品文档固定类名。

## 入口

```bash
pnpm dev:init
pnpm --dir apps/campus-web dev
pnpm --dir apps/campus-web test
pnpm --dir apps/campus-web test:e2e:smoke
pnpm --dir apps/campus-web build
pnpm --dir apps/campus-web typecheck
```

完整产品开发优先使用根 `pnpm dev`，它同时启动 app-api 与 Ops Web。单独启动 Campus Web 前先执行 `pnpm dev:init`；应用从当前 worktree 的 `.dev.vars.local` 读取独立端口，不读取根 `.env`。

`build:docs:fixture` 用于无凭据的本地文档回归；`build:release` 使用已发布的文档 release 构建正式
候选。发布步骤见文档发布合同和 release runbook。

## 相关文档

- `docs/product/web.md`
- `docs/product/ui.md`
- `docs/architecture/system/ui-foundation.md`
- `docs/architecture/system/product-runtime.md`
- `docs/architecture/system/identity-authz.md`
- `docs/architecture/system/document-site.md`
- `docs/runbooks/e2e.md`
