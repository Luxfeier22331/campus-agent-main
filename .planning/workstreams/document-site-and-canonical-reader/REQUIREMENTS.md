---
doc_type: requirements
status: active
created: 2026-04-21
updated: 2026-04-28
---

# Requirements: Document Site And Canonical Reader

## Goal

为 `campus-agent` 建立独立的 docs-first 文档站、published reader assets
与 canonical document reader lane，冻结 browser surface、reader model、
docs/search/citation control-plane seam，以及 public/restricted/historical
reader 的长期边界。

## In Scope

- `public-docs` 作为独立 browser surface 的产品边界
- published static reader assets 的长期 delivery posture
- object storage key layout 与 deploy sync manifest contract
- `app-api` docs navigation / search / resolve / version seams
- canonical reader projection 的逻辑模型
- `anchor + rootUnitId` 作为用户态定位 contract
- docs search 与 chat source card 的统一 reader target
- chat 来源展示的类型化 source item contract：canonical reader、公开通知原始 URL、notice reader 与 restricted notice 必须显式区分
- public notice URL 跳转的 allowlist、外链语义、权限提示与用户可理解动作文案
- public / restricted reader 的统一 admission model
- version-aware docs route 与 citation jump contract

## Non-goals

- PDF reader 或原始附件消费
- source-truth/provider artifact 用户态浏览
- docs search / retrieval backend 的底层算法优化
- 当前 merged truth 变更声明
- 把 docs site 并进 `public-chat-web`

## Public Docs Rendering Requirements

这些要求来自 `public-docs` 对真实 canonical 文档的 live smoke 抽样。它们属于生成器 / canonical
consumption 层的结构化要求，不应通过手改 `apps/public-docs/docs/**` 生成文档或纯 CSS 伪装解决。

1. 学生手册中的章、节、条层级必须保持为 reader 结构；如果 `二、管理`、`三、项目`、`四、本科生研究训练计划的组织与实施`
   等章标题被拼进上一条正文，生成器必须拆出并渲染为独立标题。
2. 学生手册中的中文括号枚举必须渲染为可扫描的列表或等价结构，不得把 `(一)...(二)...(三)...`
   等法规模板内容压成单个长段落。
3. 学生手册中的附录、条件、程序、职责、负责范围和“主要包括”类引导句必须渲染为稳定的标签块或语义子标题，
   并与后续列表形成明确关系。
4. 培养方案中表示下一个内容块开始的专业标记必须进入 reader 层级，例如 `计算机科学与技术专业毕业要求:`
   不应作为普通正文段落出现。
5. 培养方案中的短标签、课程清单引导句、培养目标细化引导句与实践要求引导句必须被分类处理：
   可导航标题、非导航标签块、表格/list lead-in 与普通正文不能混用。
6. 培养方案中的 `(1)...;(2)...;(3)...`、`1)...;2)...;3)...`、`(一)...(二)...(三)...` 等内联枚举必须拆成可读结构，
   但规则必须避免误拆课程名、专业名或普通括号说明。
7. 生成表格标题必须以 caption-like 结构绑定到后续表格，不应作为普通正文，也不应进入右侧大纲。
8. 宽表必须保持页面级无横向溢出；当表格需要内部横向滚动时，移动端必须有低噪音的滚动可发现性提示。
9. 抽样发现必须优先回到上游生成器或 canonical consumption 规则修复；`apps/public-docs/docs/**`
   作为生成产物不得作为长期手工修复面。
10. Rspress 锚点 `#` 进入 `innerText` 但不进入视觉标题或可访问标题名时，不计为当前缺陷；只有视觉或
    accessibility tree 出现真实噪声时才新增需求。
11. `public-docs` 开发环境同步出来的真实 canonical 文档、课程地图数据与流程图数据必须进入
    `.gitignore` 治理；repo 只追踪文档站壳、主题、生成器、测试、必要 public asset 约定与少量
    bootstrap scaffold，不把本地生成的 reader 内容当作人工源文件提交。

## Chat Source Surface Requirements

这些要求来自 Phase 7 重新打开的 chatbot 来源展示设计。当前 Phase 5 的 docs-only source cards
已经能把 RAG evidence 跳到 canonical reader；Phase 7 的目标是让同一浏览器来源区同时安全表达
canonical 文档、公开通知原始 URL、notice reader 与 restricted notice。

1. source item 必须携带显式 `targetKind`，不得让前端通过 `href` 猜测来源类型。
2. canonical reader 来源必须继续只跳 `/docs/...` 相对路径，并保留 `anchor + rootUnitId`
   highlight contract。
3. public notice 原始链接必须走独立 allowlist；只允许已 admission 的学校官网、公开通知源或公开镜像源。
4. restricted / internal notice 在未授权用户路径不得暴露 portal URL、object storage key、notice raw locator
   或内部下载链接。
5. 同一来源同时具备 canonical reader 与 public original URL 时，主操作必须表达用户将看到的内容，例如
   `查看整理版`；原始通知只能作为明确的次操作 `原通知`。
6. 浏览器可见动作文案必须按来源类型区分：`查看文档`、`打开原通知`、`查看整理版`、`需登录查看`
   等，不得统一使用含混的 `查看原文`。
7. 来源展示应从重卡片降为紧凑来源列表；默认最多展示 3 条，超过后允许展开，避免挤压回答正文。
8. 来源 payload 不得重新暴露 `chunk_id`、`source_unit_key`、raw source locator、object storage key 或内部
   notice id 作为用户态链接参数。
9. 外链必须具备用户可理解的上下文；如果未来选择新标签打开，必须在可访问文本中说明。
10. Phase 7 只调整 chat/browser-facing source surface 与 app-api projection contract，不重开 notice
    acquisition、canonical ingestion、retrieval ranking 或 docs reader asset pipeline。

## Success Criteria

1. repo 中存在独立 workstream，明确把文档站、reader model、source-card jump 与后续实现顺序收口到同一条线。
2. `public-docs` 被正式定义为独立 browser surface，而不是 `public-chat-web` 的页面模式。
3. public published reader content 被正式定义为静态 reader assets，而不是由 API 每次返回正文。
4. canonical reader model 明确以 `anchor` 和 `rootUnitId` 为用户态定位单位，不暴露 `chunkId`。
5. `app-api` docs HTTP seams 被正式写成独立 control-plane contract，覆盖
   navigation、resolve、version list 与 docs search。
6. restricted / gated reader 的 delivery mode 被显式收口，不因静态化而绕过 authz。
7. published reader assets 的长期真相被正式固定在对象存储；deploy 只复制公开子集到
   Worker static assets，不把 repo `assets/` 目录当真相。
8. chat 来源展示被正式定义为 source-card jump 到 canonical reader，而不是把 raw locator 写回正文。
9. public / restricted / historical reader 的前向路线被写清，后续实现不需要重新争论“是否做两套 reader”。
10. 当前 repo 中已经存在的 `public-docs` shell 不再被 planning 文档误写成“尚未创建”；
    后续收口只围绕 contract convergence，而不是重复创建 docs app。
11. 真实 canonical 文档进入 `public-docs` 后，章节、条款、列表、表格标题、短标签与宽表交互必须满足
    `Public Docs Rendering Requirements`，并通过抽样 smoke 证明不是只修单页样本。
12. `public-docs` 的 dev 生成内容不得作为 tracked truth 留在 git 中；清理 tracked 生成产物后，
    `sync:real-docs`、`lint:generated`、`typecheck` 与 `build` 仍必须可重复恢复同等可浏览文档站。
13. chatbot 来源展示支持类型化来源列表：用户能区分文档、通知、整理版与 restricted 来源，并能通过安全
    allowlist 跳到 canonical reader 或公开原始通知 URL。

## Canonical Entry

- `.planning/workstreams/document-site-and-canonical-reader/README.md`
