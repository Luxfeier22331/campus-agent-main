# campus-web

学生使用的 React 应用与 Cloudflare Worker，提供问答、账号、文档、地图、食堂和同好群页面。

## 职责

- 组合产品路由、共享导航、认证界面和领域页面；
- 提供邮箱验证、密码恢复、强制改密和账号注销流程；
- 通过 Service Binding 或配置的来源调用 app-api；
- 在 `/docs/*` 构建和交付原生文档目录与阅读器；
- 按明确 Dining release 加载完整地图和不可变 SVG 资源；
- 维护浏览器与 Worker 的错误、日志和调用链接入。

本应用不拥有产品数据库、Agent 编排、知识检索、文档来源采集或运维页面。

## 界面实现

- `@campus-agent/ui` 提供仓库语义 Token 和跨应用基础控件；
- `src/design/tokens.css` 只维护页面布局、问答、文档、地图和 Dining 等应用 Token；
- `src/components/ui/` 只维护 Campus 专属组合控件和共享状态；
- `src/styles.css` 负责普通应用，`src/components/docs/docs-reader.css` 负责文档阅读；
- assistant-ui 负责问答交互，Better Auth UI 与 HeroUI 负责账号界面，TanStack Router 和
  FlexSearch 负责文档路由与浏览器本地搜索，索引下载、解析和查询在 Web Worker 中执行；
- 账号页复用 App API 的 Better Auth 与账号生命周期接口，不保存临时密码或注销凭据；
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

完整产品开发优先使用根 `pnpm dev`，它同时启动 app-api 与 Ops Web。单独启动 Campus Web 前先执行
`pnpm dev:init`；应用从当前 worktree 的 `.dev.vars.local` 读取独立端口，并从
`env/commands/campus-docs-source.env` 读取对象存储连接信息。开发服务读取
`campus-docs/source.json`，在当前 worktree 的
`.generated/docs-content/sources/sha256-<digest>` 中准备目录、索引和阅读资产，不生成全部静态页面。

普通应用由 `src/main.tsx` 启动，文档页面由 `src/docs-main.tsx` 补充交互。两者共享产品导航和基础
组件，但文档组件、数据源与样式不进入普通应用入口。文档页面全部公开，不读取认证会话、运行配置或
App API 文档接口。

文档构建只接受固定来源键中的规范化 `campus_docs_source.v3`，逐个核对 reader 和补充资产，
校验 reader v3 并生成最终课程图，再派生 `campus_docs_site_index.v4`、内容寻址搜索索引和
全部预渲染页面。浏览器搜索在 Web Worker 中加载索引并按文档聚合章节命中，不阻塞页面主线程，也
不依赖在线搜索服务。

`/docs` 是唯一目录入口，主区只显示发布概况；完整文档树在侧边栏和移动端目录中展示。侧边栏中的
“培养方案”和“规章制度”是不可点击标题；培养方案集合和规章主题只展开或收起文档列表，选择具体
文档后才发生页面导航。`/docs/<corpus>` 与 `/docs/<corpus>/<collection>` 不生成页面并返回 `404`。

site index 的 `redirects` 只维护旧正文地址到已发布正文固定链接的 `308`；构建同步生成静态
`_redirects`，Worker 不内置路径规则。
所有文档页面公开，不要求登录。

来源维护者使用以下命令在完整编译校验后更新固定来源键：

```bash
pnpm --dir apps/campus-web docs:source:update -- --source-file <path>
```

`dev`、`build` 和 `deploy` 自动读取该固定键，不接受手工文档版本参数，也不按对象列表或修改时间
选择内容。构建完成后会把 `sourceDigest` 写入候选元数据；它不是 Worker 运行变量。`build:test`
仅供浏览器回归生成确定性测试内容，不能作为开发或交付入口。`build:worker` 在 Campus Web 中是
这个测试入口的兼容任务名，不是正式文档构建。

`CAMPUS_WEB_BUILD_TARGET` 和 `CAMPUS_WEB_DOCS_CONTENT_ROOT` 只在构建脚本与 Vite 子进程之间传递，
不属于 Worker、Wrangler、Argo 或 GitHub Environment 配置。`OBJECT_STORE_ENDPOINT`、
`OBJECT_STORE_DERIVED_ACCESS_KEY` 和 `OBJECT_STORE_DERIVED_SECRET_KEY` 只由文档准备、来源更新等
受信任命令读取；Vite 子进程和前端产物不接收这些值。PR 候选验证只运行受影响包的测试、类型检查、
普通包构建和 Campus Web 的确定性测试构建，不访问对象存储。真实文档构建必须在具备对象存储访问的
受信任入口执行。

## 相关文档

- `docs/product/web.md`
- `docs/product/ui.md`
- `docs/architecture/system/ui-foundation.md`
- `docs/architecture/system/product-runtime.md`
- `docs/architecture/system/identity-authz.md`
- `docs/architecture/system/document-site.md`
- `docs/runbooks/e2e.md`
