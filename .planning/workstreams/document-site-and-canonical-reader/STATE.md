---
workstream: document-site-and-canonical-reader
created: 2026-04-21
updated: 2026-05-05
---

# Project State

## Current Position

**Status:** Completed
**Current Phase:** Phase 1-7 completed
**Current Phase Name:** Workstream Closeout
**Current Plan:** none
**Total Phases:** 7
**Total Plans in Phase:** 1
**Progress:** 7/7 phases completed
**Last Activity:** 2026-05-05
**Last Activity Description:** 收口 workstream completed 状态；Phase 7 已把 `app-api`
chat source projection 从 docs-only `source_cards` 升级为类型化 `source_items`，
`public-chat-web` donor message renderer 改为紧凑来源列表，并覆盖 canonical reader、
公开通知原始 URL、notice reader 与 restricted notice 的安全展示和动作文案；2026-05-05
fresh closeout 的 app-api / public-chat 定向测试、app-api typecheck 与 docs lint 通过，
真实 staging chat E2E 和 repo-wide web lint 的当前阻塞已记录并移交到对应入口/其他
workstream。

## Completed Slice

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

- completed `Phase 6` artifacts:
  - plan: `.planning/workstreams/document-site-and-canonical-reader/phases/phase-6-restricted-historical-reader-handoff-and-acceptance/PLAN.md`
  - summary: `.planning/workstreams/document-site-and-canonical-reader/phases/phase-6-restricted-historical-reader-handoff-and-acceptance/SUMMARY.md`

- completed local `Phase 7` artifacts:
  - plan: `.planning/workstreams/document-site-and-canonical-reader/phases/phase-7-type-aware-chat-source-surfaces-and-notice-jump-contract/PLAN.md`
  - summary: `.planning/workstreams/document-site-and-canonical-reader/phases/phase-7-type-aware-chat-source-surfaces-and-notice-jump-contract/SUMMARY.md`

- 当前已冻结的决策：
  - 文档站采用独立 `public-docs` browser surface
  - 文档站只消费清洗与归一化后的 canonical doc，不提供 PDF 消费
  - public published reader content 优先走 static reader assets，而不是 API 返回整篇正文
  - published reader assets 的长期真相固定在对象存储；Worker static
    assets 只是 deploy-time sync 复制品
  - chat 来源展示必须回链到 canonical reader，而不是暴露 raw chunk/source locator
  - Phase 7 后，chat 来源展示必须显式区分 canonical reader、公开通知原始 URL、notice reader 与
    restricted notice；前端不得用裸 `href` 推断来源语义
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
  - Phase 5 的 docs-only `source_cards` / `data-source-cards` 语义已被 Phase 7
    supersede；当前只作为 persisted legacy compatibility path 保留
  - `apps/app-api` chat response model 已新增 `source_items` structured part；
    persisted legacy `source_cards` 会在 conversation detail normalization 时转换为
    typed source items，避免 browser 继续消费 docs-only card semantics
  - `apps/app-api` runtime-command finalization 现在为 completed `rag-agent`
    answer 投影 typed `source_items`，显式区分 `canonical_reader`、
    `public_notice_url`、`notice_reader` 与 `restricted_notice`
  - `apps/app-api` public notice 原始 URL admission 只允许
    `https://muc.edu.cn`、`https://*.muc.edu.cn`（排除 `my.muc.edu.cn`）与
    `https://mp.weixin.qq.com`；restricted notice 不会把 portal URL 或 raw locator
    写进 browser payload
  - `apps/public-chat-web` 已把 shell `source_items` 映射为 AI SDK
    `data-source-items` part；legacy `source_cards` 仍在前端 mapper 中转为
    canonical-reader source items
  - `apps/public-chat-web` Vercel Chatbot donor message renderer 已把来源 UI 从重卡片改为
    紧凑来源列表：默认显示 3 条，超过可展开；动作文案使用 `查看文档`、
    `打开原通知`、`查看整理版`、`原通知`、`需登录查看` 等类型化标签
  - `apps/public-docs/scripts/_sync_real_docs/regulations.py` 已新增 public-only
    regulation 同步入口；当前对象存储没有显式 public 的 notice-derived
    regulation，因此不会生成 `campus-regulations` 公开目录

- 当前运行操作真相：
  - `docs.*` read model 已有 manifest import CLI：
    `pnpm --filter app-api docs:import-read-model -- <manifest-path>`
  - `app-api` 已有 public docs sync manifest export CLI：
    `pnpm --filter app-api docs:export-public-sync-manifest -- <output-path>`
  - `public-docs` 已有 `sync:published-reader-docs` 与
    `sync:published-reader-assets`，默认 deploy path 通过
    `build:published-reader-assets` 消费 app-owned sync manifest
  - `public-docs` Worker 已保持 same-site `/api/docs/*` proxy，其他 `/api/*`
    fail-close；Phase 4 已让 Rspress search 明确消费 same-site docs
    search API；本地静态搜索索引只作为 scope discovery 输入，不作为 search
    result owner
  - Rspress build 仍提示 theme export 迁移 warning；当前 build 可通过，
    后续若要消除 warning，应单独收口 theme export shape，而不是替换原生
    shell

## Latest Execution Evidence (2026-04-27)

The `ayafeed.com` endpoints in this dated closeout block are retained only as
historical evidence. Current campus-agent staging truth is the
`mucwiki-edge.link` hostname family; do not use the URLs below as deploy,
smoke, or runbook targets.

- real gated sample 已注入 docs registry：
  - `doc_id=curriculum:中央民族大学大学生社会实践环节实施方案`
  - `delivery_mode=gated_asset`
  - `entitlement_groups=["campus_members"]`
- local publish/import/export/build 已完成：
  - `publish_document_reader_assets` 输出 `document_count=116`、`gated_entry_count=1`、`public_entry_count=115`
  - `app-api` local `db:migrate` + `docs:import-read-model` + `docs:export-public-sync-manifest`
  - `public-docs` local `sync:published-reader-assets` 输出 `copiedAssetCount=464`、`copiedGatedDocumentCount=1`
- staging 链路已完成：
  - `app-api` `db:migrate:staging` + `docs:import-read-model:staging` + `docs:export-public-sync-manifest:staging`
  - `public-docs` `deploy:staging` 成功，version: `7a8abe84-dc49-4586-9648-49ad497ceb56`
- staging 未授权 gated live smoke：
  - `GET https://campus-docs-staging.ayafeed.com/_gated-docs/curriculum/curriculum_plan/中央民族大学大学生社会实践环节实施方案/2022-current/reader.json`
  - 返回 `404`，headers 包含 `cache-control: no-store` 与 `vary: Cookie, Authorization`
- staging 授权态 gated live smoke：
  - `APP_API_STAGING_SMOKE_AUTH_SECRET` 已轮换并写入 Cloudflare
    `app-api-staging` Worker secret；当前本机 operator copy 存在 ignored
    `.env.staging.local`，不进入 git。
  - `app-api-staging` 已部署 version
    `7bb6d1a4-9137-4f66-9b0d-3c35876f4bed`。
  - `pnpm --dir apps/app-api docs:gated:smoke:staging` 会通过部署态
    `/api/internal/staging-smoke/auth/session` 重置 `help_bot@outlook.com`，
    铸造 session cookie，并验证同一 gated reader path：
    unauthenticated `404`、authorized `200`、`Cache-Control: no-store`、
    `Vary: Cookie, Authorization`。

## Blockers

- No active implementation blocker.
- No workstream-owned `source_items` / docs reader blocker remains.
- Current repo-wide `web:lint` is blocked by unrelated active worktree changes outside this
  workstream; do not reopen this workstream for those failures.
- Current staging public-chat E2E is blocked before chat request submission by
  `exec-staging` readiness (`supervisor_exec_not_ready` / HTTP 503), not by the
  document-site browser source contract.

## Verification

### Fresh Closeout Verification (2026-05-05)

- Passed: `pnpm --filter app-api exec vitest run -c vitest.node.config.mts test/chat-command.service.test.ts test/chat-structured-parts.test.ts`
  - `2` test files, `36` tests passed.
- Passed: `pnpm --filter public-chat-web exec vitest run test/platform-chat-message-parts.test.ts test/platform-chat-mappers.test.ts test/vendor-chat-message.test.ts`
  - `3` test files, `12` tests passed.
- Passed: `pnpm --filter app-api typecheck`
- Passed: `pnpm docs:lint`
  - `247` tracked markdown files, `0` errors.
- Blocked outside this workstream: `pnpm --filter public-chat-web typecheck`
  - Fails on `packages/official-web-core/src/*` TS5097 `.ts` extension imports.
- Blocked outside this workstream: `pnpm web:lint`
  - Fails on unrelated official-web / registry / fixture formatting and
    non-null assertion diagnostics already present in the active worktree.
- Blocked outside this workstream: `pnpm --filter app-api chat:e2e:staging`
  - Result: `blocked_by=supervisor_exec_not_ready`, `chat_request_attempted=false`.
  - `exec-staging /readyz` returned `503`; bridge runtime was degraded with
    `Supervisor Python bridge readiness timed out.`

- `uv run --all-packages python -m campus_ingestion_worker.publish_document_reader_assets --manifest-path var/docs-read-model-manifest.json --manifest-object-key manifests/public-docs-reader-assets.json`
- `pnpm --filter app-api db:migrate`
- `pnpm --filter app-api docs:import-read-model ../../var/docs-read-model-manifest.json`
- `pnpm --filter app-api docs:export-public-sync-manifest ../../var/public-docs-sync-manifest.json`
- `PUBLIC_DOCS_SYNC_MANIFEST_PATH=/home/reptilian/code/campus-agent/var/public-docs-sync-manifest.json pnpm --filter public-docs build:published-reader-assets`
- `pnpm --filter app-api db:migrate:staging`
- `pnpm --filter app-api docs:import-read-model:staging ../../var/docs-read-model-manifest.json`
- `pnpm --filter app-api docs:export-public-sync-manifest:staging ../../var/public-docs-sync-manifest.staging.json`
- `PUBLIC_DOCS_SYNC_MANIFEST_PATH=/home/reptilian/code/campus-agent/var/public-docs-sync-manifest.staging.json pnpm --filter public-docs deploy:staging`
- `curl -i -sS "https://campus-docs-staging.ayafeed.com/_gated-docs/curriculum/curriculum_plan/中央民族大学大学生社会实践环节实施方案/2022-current/reader.json" | sed -n '1,40p'`
- `pnpm --dir apps/app-api exec vitest run -c vitest.node.config.mts test/principal-resolution.test.ts test/docs.service.test.ts test/staging-smoke-auth.route.test.ts test/staging-docs-gated-smoke.args.test.ts test/staging-chat-smoke.args.test.ts`
- `pnpm --dir apps/app-api typecheck`
- `pnpm --dir apps/app-api docs:gated:smoke:staging`
- `pnpm --filter app-api exec vitest run -c vitest.node.config.mts test/docs.service.test.ts test/docs.route.test.ts`
- `pnpm --filter public-docs test:worker`
- `pnpm --filter public-docs exec vitest run test/sync-published-reader-docs.test.ts test/sync-published-reader-assets.test.ts`
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

**Stopped At:** Workstream completed on 2026-05-05.

**Handoff:** 后续真实 public-chat source-item 产品入口漂移验证，归对应
public-chat 产品入口验收线承接；notice source serving 正式进入 public chat 后再补
端到端来源跳转验收。

**Reopen Rule:** 只有在 docs control-plane / published reader asset contract 漂移、
gated reader delivery 失效、chat `source_items` 重新暴露 raw retrieval / private
notice locator、source jump 在真实 public-chat 入口失败，或 notice source serving
正式打开且需要补充端到端来源跳转验收时恢复。

**Resume File:** .planning/workstreams/document-site-and-canonical-reader/ROADMAP.md
