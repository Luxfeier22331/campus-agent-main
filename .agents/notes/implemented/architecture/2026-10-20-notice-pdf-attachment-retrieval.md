# Agent Note: 通知 PDF 附件进入检索

Status: implemented

## 背景

通知正文图片已有一条完整的检索链路：`document-ocr` 扫描站内通知 → `ocr.tasks` / `ocr.pages`
保存逐页结果 → `notice-index-publisher` 在同一只读快照内把图片 OCR 文本按已发布图片序、页序
追加到 `content_text` 之后 → v10 分块 → Notice Embedding Set → 统一 publisher。见
[正文图片独立消费](../feature/2026-10-02-notice-body-image-ocr.md)。

PDF 附件此前只走到采集与发布：采集器把附件原始字节写入 source bucket
（`internal_portal/resources/sha256/<digest>`，不复制到 derived bucket），publisher 把它投影成
`notices.notice_assets` 行（`asset_kind='attachment'`，含 `content_type`、`byte_size`、
`content_sha256`、`portal_annex_id`）。OCR 与分块都显式排除附件：
`jobs/notice-index-publisher/src/source.ts` 的 `PUBLISHED_NOTICE_SOURCE_QUERY` 只取
`input #>> '{resource,kind}' = 'image'` 且 `asset_kind = 'image'`；
[PDF OCR 试点](../feature/2026-10-14-notice-pdf-ocr-pilot.md)已把 PDF 附件选入 OCR，
但明确「本轮不接入检索」。

通知附带的 PDF 常常就是制度正文、报名表、评分细则等可检索内容；只靠人工作业把它们整理成
Campus Docs reader，成本高且滞后。

## 决策

### 附件沿用 notice 身份，不新增 source_kind

附件文本保持 `source_kind='notice'`，citation 仍为 `/notices/<noticeId>`。新增第三种 `source_kind`
需要改动约九层：`jobs/retrieval-index` 的 build/apply/cleanup（`cli.ts`、`catalog.ts`、
`candidate.ts`、`cleanup-job.ts`）与 `campus_docs_serving.current_index` 迁移；
`apps/campus-search` 的 Qdrant filter（`qdrant_query.go` 的 `BuildRetrievalFilter` 是硬编码的
document/notice 二选一）与 payload 解码（`campus_docs.go` 在未知 kind 时落入 document 分支并
因缺少 `section_ref` 等字段校验失败）；`packages/search-api-go/search_result.go` 的按 kind 分支与
字段数校验；`campus-search-tool-contracts.v5.schema.json` 的 `const` 枚举；
agent-runtime（`workflow-runtime.ts` 只认 document/notice）与 agent-control
（只产出 `campus_notice`/`campus_document`）；以及 app-api、campus-web、ops-web 等五处 UI 标签映射。

附件属于其通知，学生端通知详情本就列出该附件的门户下载链接，检索结果指向通知详情页语义成立。
因此下游（Embedding Set、统一 publisher、Qdrant、campus-search、UI）零改动。

### OCR 选择扩展到附件

`document-ocr` 默认 `scan` 同时覆盖正文图片与 PDF 附件（`.pdf` 后缀，其他后缀附件仍不提交）；
`--pdf-only` 保留为只扫附件的可选过滤。一个 PDF 一个多页任务，输入记录
`noticeId`、`resource.kind='attachment'`、附件 `ordinal` 与 `contentType='application/pdf'`。
去重键 `source:${noticeId}:${key}` 对附件同样成立，重复扫描幂等。附件选择复用
`@campus-agent/notices` 的 `listNoticeSourceResources()`，不新增领域规则。

### 分块来源装配

`jobs/notice-index-publisher/src/source.ts` 在同一 repeatable-read 快照内，新增与 `image_text`
平行的 `attachment_text` 聚合：对 `asset_kind='attachment'` 且 `content_type='application/pdf'`
的资产，按 `(asset.ordinal, page_index)` 取该附件最新完成 OCR 任务的页文本，匹配条件与图片一致
（`input->>'kind'='source'`、`input->>'noticeId'=n.notice_id`、`input_sha256=asset.content_sha256`、
`input #>> '{resource,kind}'='attachment'`、`status='completed'`，取最新批次）。
`noticeSourceFromRow` 的拼接顺序为 `content_text` → 图片文本 → 各附件文本。

### 资产分段（2026-10-23，v11）

v10 只按标题切硬章节，附件开头的「关于……的通知」等非编号行不是标题，附件因此继承正文最后一节或
前一附件的 `headingPath`，可能与正文末尾合成同一 chunk；检索证据也指不出内容来自哪个附件，而
citation 指向的详情页看不到 OCR 文本。来源查询改为逐资产返回文本，`NoticeSource.assetSections`
标记每段起点：图片文字合为一段（位置在装配时已丢失，不挂任何正文标题），每个 PDF 附件一段并以
`附件《original_name》` 为 `headingPath` 首项。分块器在段首开启硬章节、重置标题上下文，段内识别的标题
接在附件名之后；标题的证据判断不跨段。边界作为结构化字段传入而非插入标记行，因为正文常见「附件：1.xxx」
行，靠标题识别区分会误判。分块定义升为 `notice_text_structure.v11`；改在全量 OCR 回填之前，重新
embedding 的范围只有已有 OCR 文本的少数通知。

### 清洗与图片债一并修

附件与图片的 OCR 文本都先经[共享清洗核心](./2026-10-20-pdf-text-cleaning-unit.md)再进入分块。
该核心同时消除图片路径既有的分块债（图片 OCR 的 HTML 表格原样进 v10、列结构丢失）：
三来源在分块前形态一致。清洗在装配步执行，不写回 `content_text`，`ocr.pages` 语义不变。

### 不写回正文

`content_text` / `content_html` 与公开通知合同保持不变，附件文本只在索引来源处组装，沿用
[正文图片独立消费](../feature/2026-10-02-notice-body-image-ocr.md)的既有取舍。

### OCR 发现与调度

`scan` 改为数据库驱动：只选已发布、未下线站内通知中尚无任何 OCR 任务的图片和 PDF 资产（覆盖判断与
索引匹配一致：内容寻址任务键，或同通知同摘要的旧任务），只为这些通知读取来源快照。原实现每轮遍历全部
站内通知并逐条读取来源对象，回填完成后每轮仍读约 5,000 个对象；也会为不进入检索的未发布通知付费识别。
`--since-days` 限定发现窗口，`--max-submissions` 替代写死的每轮 10 个上限。staging 首轮回填只开最近一个月。

Paddle 以 HTTP 400「任务提交队列已满」拒绝时任务从未被受理；此前按「提交结果未知」终态失败，staging 试点
6 个任务中 3 个因此需要人工重跑。现在与 429 一样退回 pending，本轮停止新提交；其他 400 记为明确拒绝。
运行在节流排队中被停止时任务保持 pending，不再被标记为 submitting 而终态失败。

调度维持独立 CronJob，不进入 `notice-pipeline`：断点状态已由 `ocr.tasks` 与 advisory lock 承担，结果的唯一
消费者 Build/Apply 也已是运维触发的一次性 Job，放入 Temporal 只会多一份运行状态，并让常驻 Worker 持有
OCR 外网出口和凭据。检索 Build/Apply 改为自动串联，或需要在 Ops 运行时按预算启停 OCR 时重新评估。

## 未采用方案

### 新增 `source_kind='pdf'` 或 `'file'`

可以让检索结果直接区分附件来源、为附件单独维护 citation 与 UI 标签。但要在 retrieval-index、
campus-search、search-api-go、contracts schema、agent-runtime、agent-control 和五处 UI 映射中同步
扩展，且 point 会继承 document 分支不适用（对附件无意义的 `is_current` / `corpus` / 版本字段）
的约束。当前附件与通知正文同属一份来源，收益不足以抵消跨九层的新枚举维护。

### 把附件文本写回 `content_text` 直接复用学生端展示

能省去索引来源处的组装，但改变面向学生的通知展示合同，需要同步 App API、前端与数据文档；
图片已经因为同样的理由选择在索引来源处组装，附件沿用该边界。

### 附件文本不经清洗直接分块

实现最短，但 Paddle 输出含 HTML 标签、Markdown 标记与图片引用，会让 v10 的标题、表格与字段
识别失真。清洗作为独立单元处理，见 [PDF 文本清洗单元](./2026-10-20-pdf-text-cleaning-unit.md)。

### 跨通知按内容去重 OCR

staging 可索引资产 5,478 个、不同内容 5,017 份，去重只省约 8%；任务与索引匹配都以通知为界，
[正文图片独立消费](../feature/2026-10-02-notice-body-image-ocr.md)也要求不同通知的历史不混合，收益不足以改变该边界。

### 只修 PDF、保留图片 HTML 债

改动面小，但两个来源在分块前形态不一致，且图片的表格列丢失债继续存在。三来源统一清洗，
图片与 PDF 同时受益。

## 后果

- 含 PDF 附件的已发布站内通知，在下一次 `retrieval-build` 后，其附件文本进入 Notice Chunk 与
  Embedding Set，并可通过 `campus_search` 命中，citation 指向该通知详情页；纯附件通知在附件 OCR
  完成后与纯图片通知一样进入构建。
- OCR 失败、未完成或尚无任务的附件不影响该通知进入构建；`content_text` / `content_html` 与
  公开通知接口输出不变。`notices.notice_assets`、`ocr.tasks` / `ocr.pages` 的 schema 不变；
  下游检索服务不改动。
- 图片 OCR 文本经统一清洗后，HTML 表格转为分号连接行并被 v10 `detectDelimitedTable` 识别，
  图片路径的分块债消除；图片 OCR 文本的 embedding 因此变化（更正确），需在下一次构建后重新
  发布索引，收敛窗口与 republish 相同。
- 附件文本变化会改变 chunk 数据与 Embedding Set 身份并触发重新发布；运维在附件 OCR 完成后
  执行一次 Build/Apply 即收敛。
- 多个 PDF 附件按 `asset.ordinal` 拼接；附件在来源快照更新中被替换或删除时，与图片一样按已发布
  资产摘要匹配 OCR 输入，避免读到旧字节的识别结果。v11 起 chunk 通过 `headingPath` 首项携带
  所属附件名；页级来源仍不携带，需要时另行设计。
- v10 的 `headingLevel` 只识别中文编号标题，PDF 层级若表现为 HTML `<h*>` 清洗后仍可能不被识别
  为 heading；真实附件（扫描页、复杂表格）的识别质量需在启用自动扫描后用真实样本验收，质量不足
  时再评估 PDF 专用结构处理。
- 验证：`@campus-agent/notices` 21 项、`@campus-agent/text-normalization` 6 项、`document-ocr`
  4 项、`notice-index-publisher` 176 项单测与 7 项数据库集成测试（含新增的附件消费用例：HTML
  表格页清洗为 `；` 连接行后按附件序、页序追加）全部通过；`retrieval-index` 类型检查与 bundle
  构建通过。
- 本地端到端验证（2026-10-20，隔离本地实例 + staging 真实数据 + 真实 Paddle/Embedding provider）：
  `data sync --domain notices --with-sources` 导入 2026-10-08~10-15 的 113 篇真实通知与 source
  闭包，`notice-publisher republish` 重建 15 个 PDF 附件与 28 个图片资产投影；`document-ocr`
  完成全部 15 个附件任务（含 81 页名单 PDF）与试点图片任务，其中 163 页输出含 `<table>` HTML；
  `build-chunks-local` 产出 55 通知 457 chunk，附件表格清洗为 `表格列：序号；姓名；学号；学院；奖项等级`
  形态的逻辑行且无任何 HTML/图片引用残留；`retrieval-index build`（真实 embedding provider）产出
  Notice Embedding Set 455 向量，`publish-index-local` 与 staging Docs Set 合并发布 3171 point 并
  切换 `current_index`；Qdrant 检索验证附件独有事实（如 81 页名单中的学生姓名行）可命中
  `notice:359096:*` chunk，citation `/notices/359096`。线上部署后的验收复用同一 runbook。
- 定向样本验证（2026-10-21，同一本地实例扩到 31 篇通知、109 个 OCR 任务、2,251 页，覆盖大文件、
  扫描件、表格、合集四个维度）：35MB 大文件在请求超时对齐 SDK 默认 300s 后全部成功（此前 60s
  自设超时会截断上传）；全量 1,573 通知重建 12,276 chunk、10,662 embedding、13,688 point 发布，
  广泛抽样确认 0 HTML 残留、0 markdown 图片引用残留、名单序号 1..2955 无缺口、citation 与
  通知 ID 零错配；7 个近空 chunk 为原件真实内容、7 个乱码为 provider 识别伪影。样本中发现并
  修复三个问题：提交频率触发 429（`throttledSubmission` 2s 最小间隔 + 429 退回 pending 下轮
  自愈）、表格单元格字面 `\n` 转义（清洗核心规范为空格）、目录合集标题漂移（见下条）。
- 目录合集标题漂移修复（2026-10-21）：Paddle 输出的行首 markdown 标题标记（`#`/`##`，含超界
  `#######`）残留在 OCR 文本中，使 v10 的编号标题检测全部失效；清洗步剥离行首 `#+` 后 34 个
  通知恢复标题结构。对 475 页选课手册类合集（约 80 门课程大纲，每门内部章节编号重启），新增
  `OUTLINE_ANCHOR_HEADING` 识别 `《课程名》课程大纲` 行为一级标题并作为合集内持久上下文，
  编号章节嵌套在课程名下；关键词必须在《》外（裸书名号行与通知标题不可区分）。复验 57 门课程
  各自独立、漂移 chunk 消失。
