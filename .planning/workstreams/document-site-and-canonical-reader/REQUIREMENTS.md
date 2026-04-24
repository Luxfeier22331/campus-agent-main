---
doc_type: requirements
status: active
created: 2026-04-21
updated: 2026-04-25
---

# Requirements: Document Site And Canonical Reader

## Goal

为 `campus-agent` 建立独立的 docs-first 文档站、published reader assets 与 canonical document reader lane，
冻结 browser surface、reader model、docs/search/citation control-plane seam，以及 public/restricted/historical reader 的长期边界。

## In Scope

- `public-docs` 作为独立 browser surface 的产品边界
- published static reader assets 的长期 delivery posture
- object storage key layout 与 deploy sync manifest contract
- `app-api` docs navigation / search / resolve / version seams
- canonical reader projection 的逻辑模型
- `anchor + rootUnitId` 作为用户态定位 contract
- docs search 与 chat source card 的统一 reader target
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

## Success Criteria

1. repo 中存在独立 workstream，明确把文档站、reader model、source-card jump 与后续实现顺序收口到同一条线。
2. `public-docs` 被正式定义为独立 browser surface，而不是 `public-chat-web` 的页面模式。
3. public published reader content 被正式定义为静态 reader assets，而不是由 API 每次返回正文。
4. canonical reader model 明确以 `anchor` 和 `rootUnitId` 为用户态定位单位，不暴露 `chunkId`。
5. `app-api` docs HTTP seams 被正式写成独立 control-plane contract，覆盖 navigation、resolve、version list 与 docs search。
6. restricted / gated reader 的 delivery mode 被显式收口，不因静态化而绕过 authz。
7. published reader assets 的长期真相被正式固定在对象存储；deploy 只复制公开子集到 Worker static assets，不把 repo `assets/` 目录当真相。
8. chat 来源展示被正式定义为 source-card jump 到 canonical reader，而不是把 raw locator 写回正文。
9. public / restricted / historical reader 的前向路线被写清，后续实现不需要重新争论“是否做两套 reader”。
10. 当前 repo 中已经存在的 `public-docs` shell 不再被 planning 文档误写成“尚未创建”；后续收口只围绕 contract convergence，而不是重复创建 docs app。
11. 真实 canonical 文档进入 `public-docs` 后，章节、条款、列表、表格标题、短标签与宽表交互必须满足
    `Public Docs Rendering Requirements`，并通过抽样 smoke 证明不是只修单页样本。

## Canonical Entry

- `.planning/workstreams/document-site-and-canonical-reader/README.md`
