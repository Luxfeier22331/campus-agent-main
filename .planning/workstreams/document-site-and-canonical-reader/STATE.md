---
workstream: document-site-and-canonical-reader
created: 2026-04-21
updated: 2026-04-27
---

# Project State

## Current Position

**Status:** Active
**Current Phase:** 6
**Current Phase Name:** Restricted / Historical Reader Handoff And Acceptance
**Current Plan:** `.planning/workstreams/document-site-and-canonical-reader/phases/phase-6-restricted-historical-reader-handoff-and-acceptance/PLAN.md`
**Total Phases:** 6
**Total Plans in Phase:** 0
**Progress:** 6/6 phases complete
**Last Activity:** 2026-04-27
**Last Activity Description:** Implemented Phase 6 restricted / historical reader handoff: `app-api` now enforces principal-visible docs resolve and gated asset delivery, `public-docs` now has a missing-static reader fallback shell, Cloudflare staging has `campus-agent-reader-assets-staging` bound as `DOCS_READER_ASSETS`, and local app-api/public-docs verification passes; real staging restricted bytes still require syncing gated reader assets into that bucket before live smoke.

## Current Slice

- completed `Phase 1` artifacts:
  - context: `.planning/workstreams/document-site-and-canonical-reader/phases/phase-1-document-site-architecture-and-contract-freeze/CONTEXT.md`
  - research: `.planning/workstreams/document-site-and-canonical-reader/phases/phase-1-document-site-architecture-and-contract-freeze/RESEARCH.md`
  - plan: `.planning/workstreams/document-site-and-canonical-reader/phases/phase-1-document-site-architecture-and-contract-freeze/PLAN.md`
  - summary: `.planning/workstreams/document-site-and-canonical-reader/phases/phase-1-document-site-architecture-and-contract-freeze/SUMMARY.md`

- completed `Phase 2` artifacts:
  - context: `.planning/workstreams/document-site-and-canonical-reader/phases/phase-2-published-reader-assets-and-app-api-docs-control-plane/CONTEXT.md`
  - research: `.planning/workstreams/document-site-and-canonical-reader/phases/phase-2-published-reader-assets-and-app-api-docs-control-plane/RESEARCH.md`
  - plan: `.planning/workstreams/document-site-and-canonical-reader/phases/phase-2-published-reader-assets-and-app-api-docs-control-plane/PLAN.md`
  - summary: `.planning/workstreams/document-site-and-canonical-reader/phases/phase-2-published-reader-assets-and-app-api-docs-control-plane/SUMMARY.md`

- completed `Phase 3` artifacts:
  - context: `.planning/workstreams/document-site-and-canonical-reader/phases/phase-3-public-docs-shell-convergence-and-information-architecture/CONTEXT.md`
  - plan: `.planning/workstreams/document-site-and-canonical-reader/phases/phase-3-public-docs-shell-convergence-and-information-architecture/PLAN.md`
  - summary: `.planning/workstreams/document-site-and-canonical-reader/phases/phase-3-public-docs-shell-convergence-and-information-architecture/SUMMARY.md`

- completed `Phase 4` artifacts:
  - context: `.planning/workstreams/document-site-and-canonical-reader/phases/phase-4-docs-search-version-navigation-and-static-reader-state/CONTEXT.md`
  - plan: `.planning/workstreams/document-site-and-canonical-reader/phases/phase-4-docs-search-version-navigation-and-static-reader-state/PLAN.md`
  - summary: `.planning/workstreams/document-site-and-canonical-reader/phases/phase-4-docs-search-version-navigation-and-static-reader-state/SUMMARY.md`

- completed `Phase 5` artifacts:
  - context: `.planning/workstreams/document-site-and-canonical-reader/phases/phase-5-chat-source-cards-and-canonical-jump-integration/CONTEXT.md`
  - plan: `.planning/workstreams/document-site-and-canonical-reader/phases/phase-5-chat-source-cards-and-canonical-jump-integration/PLAN.md`
  - summary: `.planning/workstreams/document-site-and-canonical-reader/phases/phase-5-chat-source-cards-and-canonical-jump-integration/SUMMARY.md`

- current `Phase 6` artifacts:
  - plan: `.planning/workstreams/document-site-and-canonical-reader/phases/phase-6-restricted-historical-reader-handoff-and-acceptance/PLAN.md`
  - summary: `.planning/workstreams/document-site-and-canonical-reader/phases/phase-6-restricted-historical-reader-handoff-and-acceptance/SUMMARY.md`

- 当前已冻结的决策：
  - 文档站采用独立 `public-docs` browser surface
  - 文档站只消费清洗与归一化后的 canonical doc，不提供 PDF 消费
  - public published reader content 优先走 static reader assets，而不是 API 返回整篇正文
  - published reader assets 的长期真相固定在对象存储；Worker static
    assets 只是 deploy-time sync 复制品
  - chat 来源展示必须回链到 canonical reader，而不是暴露 raw chunk/source locator
  - public / restricted reader 长期共用同一 reader truth，差异只在 admission / visibility
  - donor posture 采用成熟 docs-first shell 方向，而不是 chat-first shell

- `Phase 2` 已收口的 runtime truth：
  - canonical document artifacts 由 `ingestion-core` publisher 生成
    `reader.json` / `outline.json` / `meta.json` / `asset-manifest.json`
  - ingestion-worker CLI 可发布 reader assets 并产出 docs read-model manifest
  - `app-api` 可导入 docs read model，并从 read model 导出 public docs sync
    manifest
  - `public_static_asset` 与 `gated_asset` 已在 publish manifest、read model 与
    browser resolve contract 中显式分化
  - docs search 已输出 source-card-compatible canonical jump target
  - `public-docs` 默认 deploy path 改为 published reader docs + static assets
    sync，不再默认依赖 `sync-real-docs`
  - notice-derived/internal regulation 仍只允许显式 public 且无 entitlement
    子集进入公开 docs，restricted 子集等待 restricted reader / gated delivery

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
  - `apps/app-api` 已新增 `docs.*` Drizzle read model schema 与
    `0022_docs_control_plane` migration，覆盖 collections、documents、
    document_versions、reader_assets 与 search_units
  - `apps/app-api` 默认 request scope 已从 `buildUnavailableDocsService()`
    切到 runtime-backed `buildDocsService(createPgDocsReadModelStore(...))`
  - `apps/app-api` docs service 已按 public current subset fail-close：
    只向 browser 返回 `visibility_level=public`、
    `delivery_mode=public_static_asset` 且无 entitlement groups 的 navigation、
    summary、versions、resolve 与 source-card-compatible search targets
  - `apps/app-api` docs service response 不返回 object-store key、raw source
    locator 或 `chunkId`
  - `apps/public-docs` 已新增 `sync:published-reader-assets` deploy-sync
    script；该脚本按 app-owned manifest 复制公开 reader assets 到
    `doc_build/_docs/...`，校验 target path、duplicate target、source object
    presence 与 `asset-manifest.json` sha256/size
  - `apps/public-docs` published reader source generation 已收口到
    `/docs/:corpus/:collection/:documentSlug` IA：根 `/` 是文档首页，
    `/docs/` 是公开文档总览，corpus/collection landing 由 `_meta.json`
    驱动原生 Rspress sidebar
  - `apps/public-docs/scripts/rspress-sidebar.ts` 已成为 Rspress native
    sidebar config builder；它只把 `_meta.json` 转成 Rspress sidebar data，
    不替换 topnav/sidebar/layout primitives
  - `apps/public-docs/scripts/ensure-docs-scaffold.ts` 已改为补齐
    `/docs/...` 空 scaffold，且只写缺失文件，不覆盖真实同步出来的
    collection 页面
  - `apps/public-docs` generated content guard 与 `.gitignore` 已覆盖
    `docs/docs/**`，避免新的 published reader detail source 被 tracked
  - `apps/app-api` docs search canonical URL 已统一为 `?hl=...#anchor`；
    reader state parser 仍兼容旧式 `#anchor?hl=...`
  - `apps/app-api` reader resolve 对 current version 返回 current alias，对
    historical version 返回 `/v/:versionSlug` explicit route
  - public docs sync manifest 已导出所有 public static versions，并携带
    `isCurrent` / `versionLabel`；`public-docs` collection landing 仍只按
    current docs 计数
  - `apps/public-docs` published reader docs 已支持 current alias 与
    `/docs/:corpus/:collection/:documentSlug/v/:versionSlug.mdx` explicit
    version source
  - `apps/public-docs` ReaderStateEnhancer 已在 native Rspress layout 上注入
    reader highlight 与低打扰版本切换，不替换 topnav/sidebar/layout
  - `apps/app-api` chat response model 已支持 `source_cards` structured part；
    runtime-command finalization 只会为 completed `rag-agent` answer 从
    `result.evidence.sources` 投影 browser-safe canonical source cards，且只接受
    `/docs/` 相对 reader URL
  - `apps/app-api` source card projection 已按 canonical reader target 去重，最多
    返回 5 张卡；browser payload 只复制 title、sectionTitle、snippet、href、
    collectionLabel、versionLabel、pageLabel，不复制 `chunk_id`、
    `source_unit_key`、object storage key 或 raw source locator
  - `apps/public-chat-web` 已把 shell `source_cards` 映射为 AI SDK
    `data-source-cards` part，并在 Vercel Chatbot donor message renderer 中以低打扰
    “参考来源”卡片展示 “查看原文” 链接
  - `apps/public-docs/scripts/_sync_real_docs/regulations.py` 已新增 public-only
    regulation 同步入口；当前对象存储没有显式 public 的 notice-derived
    regulation，因此不会生成 `campus-regulations` 公开目录

- 当前仍未闭环的实现真相：
  - `docs.*` read model 已有 manifest import CLI：
    `pnpm --filter app-api docs:import-read-model -- <manifest-path>`
  - `app-api` 已有 public docs sync manifest export CLI：
    `pnpm --filter app-api docs:export-public-sync-manifest -- <output-path>`
  - `public-docs` 已有 `sync:published-reader-docs` 与
    `sync:published-reader-assets`，默认 deploy path 通过
    `build:published-reader-assets` 消费 app-owned sync manifest
  - `public-docs` Worker 已保持 same-site `/api/docs/*` proxy，其他 `/api/*`
    fail-close；Phase 4 已让 Rspress search fallback 增强消费 same-site docs
    search API，API 失败时回退到本地搜索
  - Rspress build 仍提示 theme export 迁移 warning；当前 build 可通过，
    后续若要消除 warning，应单独收口 theme export shape，而不是替换原生
    shell

## Blockers

- staging 仍需要执行一次真实 publish/import/export/build 链路，把对象存储 reader
  assets 与 staging Postgres `docs.*` read model 填成 live 数据。
- staging restricted reader 仍需要把 gated reader asset objects 同步进
  `campus-agent-reader-assets-staging` 后再做 live acceptance。

## Verification

- `pnpm --filter public-docs test`
- `pnpm --filter public-docs test -- test/sync-real-docs.test.ts`
- `pnpm --filter public-docs typecheck`
- `pnpm --filter public-docs lint:generated`
- `pnpm --filter app-api exec vitest run -c vitest.node.config.mts test/chat-command.service.test.ts test/chat-structured-parts.test.ts`
- `pnpm --filter public-chat-web exec vitest run test/platform-chat-message-parts.test.ts test/platform-chat-mappers.test.ts test/vendor-chat-message.test.ts`
- `pnpm --filter app-api typecheck`
- `pnpm --filter public-chat-web typecheck`
- `pnpm --filter public-docs build`
- `pnpm --filter public-docs exec vitest run
  test/sync-published-reader-docs.test.ts test/generated-docs-checker.test.ts
  test/public-docs-scaffold.test.ts`
- `pnpm --filter public-docs exec vitest run test/sync-real-docs-reader-ui.test.ts`
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
- `pnpm --filter public-docs exec vitest run test/generated-docs-checker.test.ts`
- `pnpm --filter app-api exec vitest run -c vitest.node.config.mts test/docs.read-model-manifest.test.ts test/docs.service.test.ts`
- `pnpm --filter public-docs test`
- `pnpm --filter public-docs typecheck`
- `pnpm --filter public-docs lint:generated`
- `pnpm exec biome check apps/app-api/src/modules/docs/service.ts apps/public-docs/test/generated-docs-checker.test.ts`
- `pnpm --filter public-docs build`
- `pnpm --filter app-api typecheck`

## Session Continuity

**Stopped At:** `Phase 4` 已完成 docs search enhancement、current/historical
static reader version routes、anchor/highlight reader state 与低打扰版本切换。
错误的 custom reader shell 仍保持撤回状态；后续 shell 改动只能在原生
Rspress shell 上做受控样式/metadata/interaction 扩展，不得再替换
topnav/sidebar/layout primitives。下一次恢复应进入 `Phase 5`，规划 public
chat source cards 与 canonical reader jump integration。
**Resume File:** .planning/workstreams/document-site-and-canonical-reader/ROADMAP.md
