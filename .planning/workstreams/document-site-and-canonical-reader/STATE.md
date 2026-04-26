---
workstream: document-site-and-canonical-reader
created: 2026-04-21
updated: 2026-04-26
---

# Project State

## Current Position

**Status:** Active
**Current Phase:** 2
**Current Phase Name:** Published Reader Assets And App API Docs Control Plane
**Current Plan:** `.planning/workstreams/document-site-and-canonical-reader/phases/phase-2-published-reader-assets-and-app-api-docs-control-plane/PLAN.md`
**Total Phases:** 6
**Total Plans in Phase:** 1
**Progress:** 1/6 phases complete
**Last Activity:** 2026-04-26
**Last Activity Description:** Scoped the desktop `public-docs` sidebar
collapse control to the Rspress document body: collapse no longer mutates global
Rspress sidebar variables or shifts the topnav, collapsed reading mode keeps a
larger left content inset, and mobile keeps the native Rspress menu path.

## Current Slice

- completed `Phase 1` artifacts:
  - context: `.planning/workstreams/document-site-and-canonical-reader/phases/phase-1-document-site-architecture-and-contract-freeze/CONTEXT.md`
  - research: `.planning/workstreams/document-site-and-canonical-reader/phases/phase-1-document-site-architecture-and-contract-freeze/RESEARCH.md`
  - plan: `.planning/workstreams/document-site-and-canonical-reader/phases/phase-1-document-site-architecture-and-contract-freeze/PLAN.md`
  - summary: `.planning/workstreams/document-site-and-canonical-reader/phases/phase-1-document-site-architecture-and-contract-freeze/SUMMARY.md`

- current `Phase 2` artifacts:
  - context: `.planning/workstreams/document-site-and-canonical-reader/phases/phase-2-published-reader-assets-and-app-api-docs-control-plane/CONTEXT.md`
  - research: `.planning/workstreams/document-site-and-canonical-reader/phases/phase-2-published-reader-assets-and-app-api-docs-control-plane/RESEARCH.md`
  - plan: `.planning/workstreams/document-site-and-canonical-reader/phases/phase-2-published-reader-assets-and-app-api-docs-control-plane/PLAN.md`

- 当前已冻结的决策：
  - 文档站采用独立 `public-docs` browser surface
  - 文档站只消费清洗与归一化后的 canonical doc，不提供 PDF 消费
  - public published reader content 优先走 static reader assets，而不是 API 返回整篇正文
  - published reader assets 的长期真相固定在对象存储；Worker static
    assets 只是 deploy-time sync 复制品
  - chat 来源展示必须回链到 canonical reader，而不是暴露 raw chunk/source locator
  - public / restricted reader 长期共用同一 reader truth，差异只在 admission / visibility
  - donor posture 采用成熟 docs-first shell 方向，而不是 chat-first shell

- 当前需要 `Phase 2` 收口的 runtime truth：
  - canonical document artifacts 如何生成 `reader.json` / `outline.json` /
    `meta.json` / `asset-manifest.json`
  - app-owned deploy sync manifest 如何声明 public published subset
  - `app-api` docs navigation / summary / versions / resolve / search 如何正式落成
  - `public_static_asset` 与 `gated_asset` 如何在 resolve contract 中显式分化
  - docs search 如何输出 source-card-compatible canonical jump target
  - 哪些样本 collection/version 作为首轮 publish/smoke 子集
  - 当前 `public-docs` shell 如何从“直接同步公开文档产物”的过渡实现，
    收口到 published reader assets + same-site docs control-plane
  - notice-derived/internal regulation 如何进入 docs：public-only 子集可进
    公开 docs，restricted 子集必须等 restricted reader / gated delivery

- 当前 repo 已有的实现真相：
  - `apps/public-docs` 已是正式 docs shell app，当前采用 `Rspress`
  - `apps/public-docs` 生成器已把学生手册分为办事流程、学籍与教学、
    行为规范与纪律、奖助与资助、住宿与公费医疗、实践服务与发展、
    通用法规等二级目录；培养方案分为本科专业与专业类、实验班与专项
    培养、强基计划、第二学士学位、通识课程、其他培养方案等二级目录
  - `apps/public-docs` runtime React components 与 generated TypeScript
    data 已移出 `docs/.components` / `docs/.generated`，分别归入
    `src/components` 与 ignored `src/generated`；Rspress public asset 仍
    保留在 ignored `docs/public/course-maps`
  - `apps/public-docs` dev 同步生成的 canonical docs、课程地图图片与
    generated TS data 已纳入 `.gitignore`，并由 `lint:generated` 拒绝重新
    进入 git tracking；普通 `build` / `dev` 只补齐缺失 collection 的空
    scaffold，不隐式访问对象存储
  - `apps/public-docs` 生成器已覆盖一批 reader-facing rendering repairs：
    学生手册 lead-in label、密集 `(一)(二)(三)` 枚举分段、行内
    `二、管理` 等章节点标题化、培养方案 `...专业毕业要求:` 标题化、
    弱结构标签 lead-in 化、`表 1 ...` caption 化、`(1)` / `1)`
    密集枚举分段与宽表横向滚动
  - `apps/public-docs` 课程地图组件已使用 occurrence key 处理同名同学期
    节点和重复边，避免 live smoke 中出现 React duplicate-key 渲染告警
  - `apps/public-docs` 已恢复原生 Rspress `OriginalLayout`，不再自建
    `Nav` / `Sidebar` / `DocContent` / `Outline` 组合；reader frontmatter
    已从 `readerProfile` 收口为 `documentKind` / `readerLayout` /
    `readerMeasure` / `readerOutline`，其中文档来源类型不再直接决定正文
    宽度
  - `apps/public-docs` reader CSS 已改为 page measure 与 prose measure
    分离：页面容器按 `standard` / `wide` / `full` 占用正文区，普通段落
    独立限制行长，表格、流程图等结构化块允许在同一页面内展开
  - `apps/public-docs` 文档来源与版本元信息已收口为低打扰摘要：
    默认只显示面向用户的版本、原文页码与来源标签，raw PDF filename、
    `doc_id` / `version_id` / collection 等审计字段进入 `来源详情`
    fixed disclosure，默认 `当前展示版` 状态不再暴露
  - `apps/public-docs` collection sidebar 已去掉 `学生手册概览` /
    `培养方案概览` 子入口；顶层 `学生手册` / `培养方案` 仍链接到各自
    index 页面，左侧目录直接进入实际分类
  - `apps/public-docs` desktop reader padding 已拆为
    `--docs-reader-padding-left` / `--docs-reader-padding-right`，左侧比右侧
    多 `0.5rem`；移动端仍使用原有窄屏 padding，避免牺牲正文宽度
  - `apps/public-docs` 已在原生 Rspress shell 上新增桌面整栏目录收起/
    展开控件：通过 global UI component 写入 `data-docs-sidebar` 状态，
    CSS 收起 native sidebar shell，localStorage 记忆用户选择；收起状态
    同步 `aria-hidden` / `inert`，避免隐藏目录继续进入键盘与可访问树；
    `<900px` 移动断点会清除桌面状态并继续走 Rspress 原生移动菜单；收起
    状态只作用于 `.rp-doc-layout__container` 内部，不再覆盖
    `--rp-sidebar-width` / `--rp-sidebar-margin-left` 等全局 Rspress 变量，
    因此 topnav 在展开/收起时保持固定坐标；正文通过
    `--docs-reader-collapsed-padding-left` 获得更大的左侧阅读留白
  - `apps/public-docs` canonical document tables 保持静态文档阅读模型，不引入
    TanStack Table 这类交互 data-grid；表头、分组、sticky 首列与横向滚动
    提示已改用中性白灰 tokens，避免把学校绿色 accent 扩散到整张表格
  - `packages/ingestion-core` 课程地图 inventory 已适配 MinerU 的图文顺序：
    支持 `figure_title` / `figure_caption` / `table_caption` 中出现
    `课程地图` / `拓扑图` hint 后的图片块，也支持图片块紧邻且位于后续
    `课程地图` heading 之前的版式；这修复了
    `中国少数民族语言文学（古文字学方向）强基计划本科人才培养方案`
    page 125 的漏识别
  - 当前课程地图覆盖率为 `47/70` 个培养方案页面；全部本科专业与专业类
    已有课程地图，剩余 `23` 个无课程地图页面分布在通识课程、第二学士
    学位、大学生社会实践环节实施方案、少数民族预科教育人才培养方案，以及
    理工科交叉创新人才培养实验班本科人才培养方案
  - 剩余 `23` 个无课程地图页面已回查当前 MinerU layout：
    `22` 个没有课程地图 hint 与图片；理工科交叉创新实验班仅包含
    `参见各专业培养方案的课程地图` 文本，没有图像块；通识课程“大学体育”
    有 1 个 image row，但没有课程地图 hint，父级为 `1. 第5—7学期`，
    不应作为课程地图发布
  - `apps/public-docs` 已撤回上一轮 custom doc layout shell；该错误实现会
    破坏 Rspress 原生 topnav 与 sidebar positioning，不得作为后续 shell
    收口方向
  - `packages/ingestion-core/src/campus_ingestion_core/document_reader_assets.py`
    已存在 reader asset package builder 与 `public_docs` sync manifest builder
  - `apps/app-api/src/app/routes/docs.ts` 已注册 docs route shell
  - `apps/app-api/src/modules/docs/index.ts` 已冻结 docs browser contract types
  - `apps/public-docs/scripts/_sync_real_docs/regulations.py` 已新增 public-only
    regulation 同步入口；当前对象存储没有显式 public 的 notice-derived
    regulation，因此不会生成 `campus-regulations` 公开目录

- 当前仍未闭环的实现真相：
  - `app-api` 默认 wiring 仍回落到 `buildUnavailableDocsService()`，
    docs routes 还不是 runtime-backed live service
  - `public-docs` 当前仍通过 `sync-real-docs.ts` 直接同步公开文档产物，
    不是 published reader assets + same-site `/api/docs/*` consumption
  - `public-docs` 当前 shell 还没有把 navigation / resolve / version /
    search 全部切到 `app-api` docs control-plane
  - Rspress build 仍提示 theme export 迁移 warning；当前 build 可通过，
    后续若要消除 warning，应单独收口 theme export shape，而不是替换原生
    shell

## Blockers

- 当前 `app-api` docs route shell 还没有接上 runtime-backed docs service；默认配置下只会返回 `docs_not_configured`。
- 当前 `public-docs` shell 仍未消费 same-site `/api/docs/*` 与 published reader assets，因此当前文档站仍停留在过渡实现。
- 当前 phase planning truth 刚从“docs app 还不存在”的旧叙述迁移出来，仍需要与现有代码真相重新对齐。
- 当前 public chat 仍未消费 canonical source-card payload，但这属于 `Phase 5`，不阻塞本 phase。

## Verification

- `pnpm --filter public-docs test`
- `pnpm --filter public-docs test -- test/sync-real-docs.test.ts`
- `pnpm --filter public-docs typecheck`
- `pnpm --filter public-docs lint:generated`
- `pnpm --filter public-docs build`
- `pnpm --filter public-docs sync:real-docs`
- `pnpm web:lint`
- `uv run --all-packages python -m unittest tests.ingestion.test_curriculum_provider_normalize`
- static scans for dense `(1)` / `1)` enumerations, unstyled course-list lead-ins,
  stale global-competence slash, stale cross-discipline split, stale sample docs
  directories, and unstyled weak curriculum subsection labels
- Chrome DevTools MCP smoke on `http://127.0.0.1:4178` for home,
  curriculum landing, student-handbook manual page, curriculum page, desktop
  native topnav/sidebar positioning, sidebar/outline geometry, mobile native
  menu behavior, and horizontal overflow
- Playwright smoke on `http://127.0.0.1:5177` for home, student-handbook
  index/grouped workflow page, curriculum index, computer/design curriculum pages,
  desktop sidebar IA, mobile search/menu presence, wide-table behavior,
  course-map render/image loading, and generated footer suppression
- Chrome DevTools MCP smoke on `http://127.0.0.1:4178` design curriculum page
  for neutral desktop table colors, no console messages, and mobile row-card
  table reading behavior
- `uv run --all-packages python -m unittest
  tests.ingestion.curriculum_course_map_multimodal_probe_inventory_suite
  tests.ingestion.test_curriculum_course_map_docs_surface
  tests.ingestion.test_materialize_curriculum_course_map_docs_surface_worker`
- `pnpm --filter public-docs exec vitest run test/sync-real-docs.test.ts -t
  "CourseMap|course map|course-map|课程地图" --testTimeout=30000`
- `pnpm --filter public-docs exec vitest run test/sync-real-docs.test.ts
  --testTimeout=120000`
- `pnpm --filter public-docs typecheck`
- `pnpm --filter public-docs lint:generated`
- `pnpm --filter public-docs build`
- Chrome DevTools MCP smoke on `http://127.0.0.1:4177` strong-base ancient-script
  curriculum page: `六、课程地图` renders, 3 course-map tabs are present, current
  course-map image loads with HTTP 200, and console has no messages
- `pnpm --filter public-docs exec vitest run test/sync-real-docs-reader-ui.test.ts`
- `pnpm --filter public-docs typecheck`
- `pnpm --filter public-docs build`
- Chrome DevTools MCP smoke on `http://127.0.0.1:4177` curriculum pages:
  desktop sidebar collapse/expand changes the whole native left sidebar width
  between `288px` and `0px`, keeps topnav brand/search/nav coordinates unchanged,
  increases desktop collapsed main left padding from `48px` to `64px`, persists
  across reload, removes collapsed sidebar from a11y/keyboard flow via
  `aria-hidden` / `inert`, does not overlap the document title, leaves mobile
  `<900px` without the desktop toggle, and emits no console messages

## Session Continuity

**Stopped At:** `public-docs` canonical rendering、IA/layout、generated
content governance、reader layout contract、source/version metadata display
、强基计划古文字方向课程地图漏识别与桌面整栏目录收起/展开已收口；
当前真实课程地图覆盖率为 `47/70`，剩余缺口均已按源文档无课程地图分类。
错误的 custom reader shell 已撤回并恢复原生 Rspress shell；后续 shell
改动只能在原生 Rspress shell 上做受控样式/metadata/interaction 扩展，不得
再替换 topnav/sidebar/layout primitives。下一次恢复应回到 `Phase 2` 的
runtime-backed docs service、published reader assets、same-site `/api/docs/*`
shell consumption 收口项。
**Resume File:** .planning/workstreams/document-site-and-canonical-reader/phases/phase-2-published-reader-assets-and-app-api-docs-control-plane/PLAN.md
