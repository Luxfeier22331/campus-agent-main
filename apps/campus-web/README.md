# campus-web

学生使用的 React 应用与 Cloudflare Worker，提供问答、账号、文档、地图、食堂和校园服务页面。

## 职责

- 组合产品路由、共享导航、认证界面和领域页面；
- 通过 Service Binding 或配置的来源调用 app-api；
- 在 `/docs/*` 构建和交付 Rspress 阅读器；
- 交付应用内地图和 Dining 静态资产；
- 维护浏览器与 Worker 的错误、日志和调用链接入。

本应用不拥有产品数据库、Agent 编排、知识检索、文档发布或运维页面。

## 界面实现

- `src/design/tokens.css` 维护基础值、语义 Token、共享组件 Token 和领域可视化 Token；
- `src/components/ui/` 维护跨页面控件和共享状态；
- `src/styles.css` 与 `theme/docs-ui.css` 只适配应用和 Rspress；
- assistant-ui 负责问答交互，Better Auth UI 与 HeroUI 负责账号界面，Rspress 负责文档阅读；
- 普通共享控件使用仓库的 shadcn/Radix wrapper，单场景展示优先使用语义 HTML；
- `src/components/ui/motion.tsx` 统一共享交互动效并处理 reduced motion；
- `SurfaceState` 用于区域级读取、空状态、错误和降级状态。

页面布局分为阅读、表单、工作区和沉浸式四类，具体组件尺寸与样式由 Token、组件和测试维护，不在
产品文档固定类名。

## 入口

```bash
pnpm --dir apps/campus-web dev
pnpm --dir apps/campus-web test
pnpm --dir apps/campus-web test:e2e:smoke
pnpm --dir apps/campus-web build
pnpm --dir apps/campus-web typecheck
```

`build:docs:fixture` 用于无凭据的本地文档回归；`build:release` 使用已发布的文档 release 构建正式
候选。发布步骤见文档发布合同和 release runbook。

## 相关文档

- `docs/product/web.md`
- `docs/architecture/system/product-runtime.md`
- `docs/architecture/system/identity-authz.md`
- `docs/architecture/system/document-site.md`
- `docs/runbooks/e2e.md`
