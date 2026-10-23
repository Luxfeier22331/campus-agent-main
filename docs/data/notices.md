---
doc_type: data
owner_boundary: domains/notices
status: active
---
# 通知数据

## 边界

本文统一维护通知来源对象、规范化投影和资源的长期数据语义。HTTP 响应由
[通知接口](../contracts/app-api/notices.md) 维护，采集和发布步骤由 [采集运行](../runbooks/ingestion/ingestion.md) 维护。

来源对象保存门户原始数据；采集器在来源和必需资源齐备后同时登记 `notices.notices`。数据库中的
`category` 是唯一分类状态，学生端读取要求 `is_published=true` 且 `unavailable_at IS NULL`。通知数据不保存采集批次、模型理由、
置信度、原始模型响应、阅读状态或下游处理状态。

## 来源对象

`internal-portal-collection` 的本地 CLI 和一次性 Job 读取门户通知选择器、全局列表和详情，在 source
bucket 写入 `internal_portal_notice_source.v2`。选择器返回的类型集合是采集范围；空类型全局列表只
提供跨类型增量顺序，其中不属于选择器范围的条目不会落桶：

```text
internal_portal/notices/<notice-id>/sources/<sha256>.json
```

迁移前的固定 key `internal_portal/notices/<notice-id>.json` 只作为旧数据兼容入口；新采集不会覆盖它。

来源对象保存 `notice_id`、`notice_type`、`organization_id`、原始标题、发布时间、外链标记与 URL、
门户 HTML 正文和附件 metadata。类型和组织名称不在每条通知重复，集中保存在：

```text
internal_portal/meta.json
```

`internal_portal_meta.v1` 保存通知选择器返回的类型与组织名称映射；历史回填还会补入通知列表中实际
出现的组织映射。采集器合并已有映射：当前选择器返回的同 ID 名称优先，当前未返回的历史 ID 保留。

内部通知固定使用 `is_external=false`、`external_url=null`；门户实际返回 HTTP 或 HTTPS URL 时使用
`is_external=true` 并保留该 URL。采集器不请求外部页面，`notice_content_html` 只表示门户详情接口
返回的正文。

同一 `notice_id` 表示门户当前通知。发布时间、标题、正文、外链和资源都可能更新；采集器在列表变化或周期复核时重新请求详情，并为当前完整来源保存内容寻址快照。`notice-rescan` 和周期复核承担同 ID 内容更新发现。`released_at` 是当前门户发布时间，不是首次发布时间或正文修改时间。

同步边界保存在：

```text
internal_portal/notices/_state.json
```

`internal_portal_notice_sync_state.v4` 记录通知维护的半开日期区间和更新时间，以及有界的
`unavailable_notice_ids`（上限 500，超出淘汰最旧）。v3 状态文件仍可读取，写入一律升级为 v4：

```text
[covered_from, covered_until)
```

`covered_from` 包含，`covered_until` 排除。区间是通知维护范围的唯一边界，不根据通知 ID 数值推断新旧。
`notice-sync` 发现门户最新边界 `P` 后扫描 `[max(covered_from, covered_until 前一天), max(covered_until, P))`，
重扫最后一个覆盖日期以发现同日稍后发布的通知；成功后上界只前进、不后退；
`notice-backfill --start-date S` 只采集 `[S, covered_from)`，成功后推进到
`[S, covered_until)`；集群流水线按窗口逐段采集该区间，每个成功窗口都把下界推进到窗口起点，区间仍保持连续。首次初始化必须显式回填（当前约定起点为 `2025-12-01`），不能用一次 sync 只记录
一个不完整的 head。

`notice-rescan --from F --to T` 显式补查已有维护区间内的遗漏，区间仍为半开区间；不修改维护边界。
sync、backfill、rescan 和周期复核都可刷新已有通知详情；无变化时复用同一快照引用。
刷新后的详情与已有快照除资源外一致时，沿用已有资源引用并以 HEAD 检查对象存在；详情变化时才重新下载附件和图片。
backfill 只扩展下界，保留周期复核时间戳。
`noticesAdded` 统计本轮新登记的通知，sync 的 `upToDate=true` 只表示本轮没有新增，不宣称历史绝无遗漏。

门户列表的 `end_date` 是闭区间参数，适配器把内部排他上界转换为前一天；详情中的门户发布时间会再次按
`[start,end)` 校验，以排除边界泄漏。门户最新边界由未过滤列表中已检查通知的最大 `notice_release_time`，
或其详情发布时间，推导为该日期的下一天。门户列表可能把 `notice_stick=1` 的旧通知置于新通知之前；适配器至少检查
包含非置顶记录的页，若整页均为置顶则继续分页；非置顶记录按发布时间倒序。置顶标记只参与上界探测，
不改变内部通知的展示排序。标记缺失或不合法时探测失败，不推进维护区间。空门户使用运行时的门户日期下一天。

通知对象、其引用的图片和非永久缺失附件、以及 `meta.json` 全部成功后才推进状态；已有合法 source 对象仍会检查并
补齐缺失资源，明确返回 HTTP 404 的通知图片和附件除外。增量同步、历史回填与遗漏补查通过 PostgreSQL advisory lock 串行执行。旧
`internal_portal_notice_sync_state.v2` 只作为迁移输入读取；它没有可靠的排他上界，下一次 backfill 会重新
建立完整 v4 区间，sync 在此之前拒绝运行。通知独立、随机消费，不创建 `captures/` 批次。

采集 Job 的 `processedRange` 只记录本次尝试扫描的半开区间；它不是数据库维护边界，也不能在失败后代替
`_state.json`。只有 source、必需资源、库存映射和状态文件都成功写入后，`maintenanceRange` 才反映新的
`[covered_from, covered_until)`；通知图片或附件明确返回 HTTP 404 时属于永久缺失，不要求资源对象存在，也不阻止该通知
登记或维护边界推进。因此一个真正失败的 Job 可以有处理进度和本次处理区间，但下一次 Job 仍应从未推进的维护边界
继续。分类和发布 Job 不拥有日期维护边界，只返回各自的数量摘要。

跨运行时字段和校验规则以 `packages/ingestion-contracts/schemas/` 中登记的 JSON Schema 为可执行来源。

## 来源资源

`notice-sync` 和 `notice-backfill` 在详情采集后下载资源，把门户图片和附件原始字节写入：

```text
internal_portal/resources/sha256/<digest>
```

图片 source ordinal 按来源 HTML 中可采集门户图片的原始顺序计算。编辑器占位图不下载，因此图片 key
可以不连续；publisher 使用 source ordinal 读取正确字节，再为正文占位符和 PostgreSQL 生成连续的
展示 ordinal。附件 ordinal 与来源 metadata 顺序一致。

附件的 `notice_annex_id` 是门户资源身份，`notice_annex_path` 只作为来源 metadata 保留。正常采集按内容摘要保存资源并在来源快照中记录对象引用，不抓取外部正文。通知图片或附件下载明确返回 HTTP 404
时，来源快照记录该资源但不创建资源对象（`object_key` 为 `null`），附件 metadata 保留；该资源不会生成
`notice_assets` 投影。发布和 Ops 预览从正文中去掉缺失图片，其余图片的展示 ordinal 仍连续，source ordinal 不变。
其他下载错误仍使通知采集失败。仓库不再提供独立的资源维护或状态查看入口。

## 分类交接

`jobs/notice-classifier` 只给内部通知打标签，外部通知不分类。标签是两个正交字段：`label_category`
（15 类，业务主题）与 `label_intent`（`action`、`event`、`notice`、`result`、`reference`，读者要做什么），
值集合由 `campus-contracts/notices` 的 `NOTICE_LABEL_CATEGORIES` 与 `NOTICE_LABEL_INTENTS` 登记，两列同空同有。
时效不在标签里，读者侧按 intent 与发布时间组合入口。
分类只依据标题与门户栏目：先按 `notice_type` 走 `notice-classifier-core` 的规则车道，标题信号明确的直接
给出标签；其余交给 Model Config 当前选择的后端（决策模型或 LLM），两者使用同一份判定文本。判定文本、
规则与取舍见[通知标签重设计](../../.agents/notes/proposed/feature/2026-10-21-notice-classification-redesign.md)。

默认批量只处理仍无标签的内部通知，不覆盖分类期间发生的人工修改；显式单条分类与「全量重判内部通知」
覆盖已有标签，后者在切换分类后端或升级判定文本后由运维发起。分类完成不表示通知已发布。

旧 `category` 列在第二次发布前继续服务学生端、发布与 Ops 编辑；新分类 Job 不再写它，过渡期新通知
没有旧分类，不会被发布。

## 当前处理问题

`notices.processing_failures` 以 `(notice_id, stage)` 为主键，stage 为 classification 或 publication，
保存当前错误类型、原始错误和发生时间，不保存执行历史。自动批次排除对应阶段的问题；显式单条重试
仍可处理，业务写入成功后在同一事务中清除问题。有效人工分类修改同时清除分类问题。
模型输出或来源数据错误隔离到单条，基础设施错误终止本轮，Ops `/tasks` 展示问题数量并链接通知维护。
分类、发布的手动与定时入口共用各自数据库会话锁；锁忙返回 skipped，锁失效停止接新工作。

采集（ingestion）阶段没有 `processing_failures` 记录：detail 缺失或 source 构造失败时通知行尚不存在，
无法按 `(notice_id, stage)` 落库。采集失败只进入任务摘要（`noticesFailed`、`outcome: partial`）与
stderr JSON（`operation` 为 `download`、`detail`、`item`、`source` 或 `inventory`），状态不推进直到重跑
成功；通知行在库存登记成功后才存在。单条通知的数据性失败（含列表项 `notice_type` 非法）不阻断同批
其余通知，认证错误、列表项 `notice_id` 非法、分页不一致与 notice type 映射错误仍终止整批；
organization 映射异常仅记诊断日志，不阻断批次。

重新发布与发布共用 publication 失败记录：单条数据性失败按通知隔离、跳过并继续，基础设施错误终止
本轮；自动 republish 批次不排除已有失败记录的通知，成功重物化在同一事务中清除记录。重新发布不触发
chunk/embedding 制品，正文变化在下一次完整检索刷新进入 AI 搜索，收敛窗口见
[通知索引 runbook](../runbooks/ingestion/notice-indexing.md#与-republish-的一致性)。

## 规范化投影

### PostgreSQL

`notices.notice_types` 和 `notices.organizations` 保存门户 ID 与名称映射，`notices.categories` 保存允许的
旧分类。`notices.notices` 从采集完成后即存在，保存通知 ID、类型、可空组织 ID、原始标题、发布时间、
外链标记与 URL、可空 `category`、可空 `label_category` 与 `label_intent`（只允许内部通知有值）、
`is_published` 以及发布后写入的 `content_html`、`content_text`。

门户确认删除的通知保留行与来源对象，仅记录 `unavailable_at`：detail 探测返回门户固定删除/失效消息时采集器写入该时间戳，
学生端查询、班车关联与检索分块输入过滤 `unavailable_at IS NULL`；复核重新取回该通知时登记行为清除 `unavailable_at`。
Ops 管理台不做该过滤。

状态只由现有字段推导：`category IS NULL` 为待分类；已有分类且 `is_published=false` 为待发布；
`is_published=true` 为已发布。已发布行必须具有分类，不增加独立工作流、审计历史或派生库存表。已发布通知
可以通过 notice-publisher 的重新发布行为重新物化当前来源的 metadata、正文和资源，但不会改变 `is_published` 或分类；当前状态
选择及重新评估条件见
[通知维护状态收敛](../../.agents/notes/implemented/architecture/2026-08-25-notice-maintenance-state.md)。

`notices.notices` 另保存当前来源 `source_ref` 和已发布来源 `published_source_ref`。publisher 以当前来源为条件，在同一事务中切换可见 metadata、正文和资源集合。

`notices.notice_assets` 按通知和资源类型保存名称、媒体类型、字节数、SHA-256 和附件的
`portal_annex_id`。图片使用从零开始的连续展示 ordinal；附件保留 source metadata ordinal，永久缺失附件会留下
ordinal 空缺。图片的 `portal_annex_id` 为空，完整门户下载 URL 不落库。表结构、字段和授权的可执行来源是
`jobs/campus-agent-schema/` 的统一 migration；`packages/domains/notices/` 只拥有正文规范化、分类和资源声明等
运行时领域逻辑，不拥有 PostgreSQL schema。

### 正文清洗

正文只接受通知领域包允许的结构化标签。脚本、样式、表单、iframe、class、ID 和事件属性被移除；
无效链接解包为文本，合法链接只允许 HTTP、HTTPS 与 mailto。来源标题、空段落和编辑器占位图不进入
投影，正文标题从 `h3` 开始。

首行缩进、对齐、粗体、下划线、警示色和高亮只转换为共享合同规定的有限属性或语义标签。表格保留
经过范围校验的合并单元格；有明确 `<thead>` 的表格按表头路径生成字段和值，没有明确表头的表格按
逻辑行输出，不根据门户的 `<th>` 或首行标记猜测字段名。单元格内部换行归并为空格，行之间保留换行，
分组行附着到后续记录。门户使用大缩进模拟的尾部落款转换为右侧对齐，原始 CSS 不进入投影。

清洗只对正文文本节点应用少量审定修正：`统计表干3月5日前` 修正为 `统计表于3月5日前`，`Al+`
在对应竞赛名称中修正为 `AI+`，`气模馆` 修正为 `气膜馆`；系统登录语境中的“登陆”修正为“登录”。
不自动修正其他来源性错字或事实内容。

来源门户图片改写为 `notice-asset:image:<ordinal>`，并保存清洗后的 `alt`。外链通知的两个正文字段
固定为空，只保留原始标题、来源 metadata 与 `external_url`；门户详情返回的包装 HTML 仍留在来源
对象中。采集器不下载外链通知声明的图片或附件，publisher 也不读取或物化这些资源。`content_text`
始终从站内通知的最终清洗 DOM 生成。

### 检索分块与制品

`jobs/notice-index-publisher` 提供已发布通知的 Chunk Run 与 Embedding Set 集群构建，以及本地结构验证、
广泛抽样和真实 Embedding dense-retrieval 评测。任务在只读 repeatable-read 快照中读取已发布站内通知，
以 `content_text` 加上当时已有的正文图片与 PDF 附件 OCR 文本作为分块输入，按已发布资产摘要匹配同通知的 OCR 输入摘要，每个资产取最新完成批次，按已发布序号、页序追加。
OCR 失败、未完成或尚无任务都不影响该通知进入构建；无正文文本和识别文本时使用通知标题。
后续识别完成后，下一次构建才读取新文本。来源适配只读 `ocr.tasks` / `ocr.pages`，Chunk 和 Embedding
不接收 OCR 状态、不等待 OCR。外链通知不参与，公开通知的两个正文字段不写入 OCR；OCR 文本经共享 HTML 清洗后追加，不写回公开正文。
图片文字合为一个分段，每个 PDF 附件各为一个分段；每个分段开启新的硬章节，不继承正文或前一附件的标题。
附件分段以 `附件《<original_name>》` 作为 `headingPath` 首项，附件内识别出的标题位于其后，
因此检索证据和 `section_title` 能指出内容来自哪个附件。

当前代码的分块定义为 `notice_text_structure.v11`，使用 Unicode 字符数，目标长度为 800 字符、硬上限为
1200 字符，硬上限包含返回证据中的章节、局部父项和表头，不使用固定 overlap。图片字节、图片引用及 `alt` 不进入正文 Chunk 或 Embedding，已有 OCR 文字和表格可以进入。结构和字段关系优先于长度：

- `一、` 等正式一级标题开启新的硬章节，Chunk 不跨一级标题；
- `（一）` 等正式二级标题开启独立语义单元，Chunk 不跨正式二级标题；带值、完整叙述或指令语义的
  括号序号行不作为二级标题；字段冒号按标题主干判断，括号时刻中的冒号不取消标题；
  带明确日期的短材料提交阶段可以作为标题，完整指令仍作为正文；
- `1.`、`2、` 等阿拉伯编号保留为父章节中的列表正文，不提升为 `headingPath`；
- 无编号短句不猜测为标题，无正式标题的通知按原始文本顺序形成语义单元；
- 直接位于章节正文中的括号事实列表按同级项保留语义边界；流程、办理步骤和条件父项下的嵌套列表保持
  为一个语义单元；
- 独立事实列表仍按同级项保留语义边界；同一章节内连续且每项少于 120 个 Unicode 字符的简单短项，
  在不含二级嵌套列表、且不超过目标长度和硬上限时允许合并；较长或结构复杂的列表项仍单独成块；
- 流程、办理步骤和连续操作列表保持在一个语义单元内；
- 列表项吸收其后属于该项的时间、地点、联系方式、URL 和说明，直到下一个同级列表项或明确结构边界；
- 条件说明父项只吸收自己的嵌套条件项，不吞并后续同级项；标签型父项与其嵌套值保持为一个语义单元；
  字段标签下的经历、说明列表保持字段组整体，不按编号层级拆分；
- 冒号标签和 `【标签】` 与后续值绑定；同级新标签开始新字段组，不依赖空行。时刻和 URL 中的冒号
  不开启字段；日期与其时段绑定，`No.N` 项目、批次、条件父项遇同级项结束；
- URL 不脱离所属标签；长扫码、报送指令不作为章节标题，短名词型“报送时间及形式”可以作为标题；
- `姓名：` 包括暂时没有姓名值的形式都可开启人物记录；
- `报告题目：` 后有报告人、报告时间时形成报告记录，不与相邻记录拼接；超长记录续块保留原文题目；
- 明确的“各组别参赛条件如下”引导语及同一行通用条件可覆盖后续正式组别标题，遇下一分组引导语或
  一级章节结束；该范围只进入证据上下文，不提升为正式标题；
- 具有明确列名、等列数连续序号行的分号表、序号名单表、分值/标准表、主队/客队赛制表和节次时间表按逻辑行构造；表头只作为
  `retrievalText` 检索与证据上下文，不写入对外 `headingPath`；
- `retrievalText` 不向每个列表 Chunk 重复注入通知导语；拆开的嵌套列表值只补充其直接父项上下文，表格行
  只补充表头上下文，这些检索上下文不写入 `content` 或对外 `headingPath`；人物记录续块保留原文姓名，长字段续块保留原文标签，均不写入对外 `headingPath`；
- 普通文本单元不将首行冒号标签传播到后续独立段落；同一原文行跨块时仍保留该行标签；
- 正文中的简短图片或二维码说明附着相邻语义单元，不单独形成低信息量 Chunk；图片占位符和图片 `alt`
  仍不进入 Chunk；
- 供稿、审核等编辑署名以及尾部组织、日期附着到前一个语义单元，不单独形成落款 Chunk；
- 表格后的落款使用普通 footer part，不标记为表格行；超长单行依次在句末、分句标点和硬上限拆分。

每个 Chunk 记录保存 `noticeId`、`chunkId`、`chunkIndex`、`content`、`headingPath` 和
`retrievalText`。`content` 只保存正文；`headingPath` 只保存识别出的正式章节路径；用于 Embedding 的
`retrievalText` 由通知标题、正式章节、必要的原文局部上下文和正文组成。统一 publisher 将首行标题
之外的内容写入 Notice point `text`，供重排和模型使用；`text_sha256` 按实际证据计算。point 使用
`campus_rag_point.v3`，消费端接受 v1/v2/v3 以支持既有集合回滚。

`chunkId` 为 `notice:<noticeId>:<chunkIndex>`，是集合内的位置标识，不是内容摘要。生产 chunks 按完整
NDJSON 字节寻址于 `notices/rag/chunk-data/sha256/<digest>/chunks.ndjson`；`notice_embedding_set.v2`
直接引用该对象。模型 target 与 `retrievalText` 摘要决定向量缓存身份；实际 chunks 决定 set 和 collection
的发布身份。算法标签、review 和 validation 不进入生产依赖链；已有 v1 set 仍可读取和回滚。

本地 `notice_chunk_run.v2` 的身份包含分块定义、chunks、review 和 validation，写入：

```text
var/notices/chunking/sha256/<run-digest>/
├── chunks.ndjson
├── manifest.json
├── review-samples.ndjson
└── validation.json
```

`notice_chunk_validation.v3` 保存正文覆盖、字符分布和拆分原因，并诊断章节跨越、footer-only Chunk、
标题正文重复、非正式 `headingPath`、独立 URL、孤立字段标签、字段和值拆分、列表续行拆分、
URL 归属拆分、表格表头上下文缺失及超长表格行拆分；表头诊断同时扫描原文分号表，覆盖未识别为 table part 的情况。review 与 validation 是
离线审阅产物，不进入 serving 读取路径。问题集直接消费与目标 Chunk Run 对齐的 Chunk，
`notice_question_generation.v8` 只让模型返回 `question`、`answer` 和一个 `chunk_ref`；所选 Chunk 的
完整 `content` 是唯一 evidence，`evidenceMode` 为 `selected-chunk-content`。生成问题不是人工 gold truth，
单 Chunk 单事实的评测范围也不限制在线问答的跨 Chunk 能力。
抽样、问题生成、Embedding 评测与同题集比较的操作和输出见
[Notice builder](../../jobs/notice-index-publisher/README.md#chunk-抽样与验证)。

v8 的选择理由、同题集对照和扩大问题集结果见
[通知结构分块决策](../../.agents/notes/implemented/architecture/2026-08-31-notice-chunk-strategy.md)。
历史离线结果不作为当前在线效果或部署状态；重新评测的命令由
[Notice builder](../../jobs/notice-index-publisher/README.md#对比两次-chunk-与-embedding-结果)维护。

Chunk 策略不为凑足目标长度跨正式章节合并，也不把所有同章节事实强行合并；合法的短事实可以保持为短
Chunk，同一 `headingPath` 下组成关系不同的短语义单元也可以保持相邻分块，例如报名说明与联系人、免费
说明与参与网址。问题生成阶段只从中选择单 Chunk 单事实问题；其他需要同时询问多个事实的问题不属于当前
评测问题集，但不改变字段标签和值、URL 与所属标签必须同块的约束。

本地分块与评测命令只生成本地 Chunk、问题集和评测制品，不写 PostgreSQL 或回写 source bucket。Notice Chunk/Embedding
builder 不直接发布 Qdrant collection 或在线绑定；完成的 Notice Embedding Set 可由统一
`retrieval-index` 与 Docs Embedding Set 组装为当前 Campus RAG collection。问题生成和
Embedding 评测都以 Chunk Run 为唯一正文输入。

### Derived 资源

publisher 校验来源资源后，只把通知图片的内容寻址对象写入 derived bucket：

```text
notices/assets/sha256/<digest>
```

实际采集到的附件原始字节继续保留在 source bucket；publisher 读取这些附件以确认媒体类型和字节数，SHA-256
直接取自来源快照的 `resources[]`（资源对象本身按该摘要寻址），但不把附件复制到 derived bucket。source bucket 由 internal-portal-collection 写入，publisher 按权限读取，
不向 Worker 或浏览器开放。App API 当前只按数据库摘要读取通知图片并通过通知所属
的同源接口返回字节；
浏览器不接收 bucket key、摘要或对象存储凭据。附件 metadata 包含门户资源身份，App API 即时构造
门户 URL，附件字节继续由门户响应。

对象存储返回 `application/octet-stream` 时，publisher 按已知文件扩展名推导媒体类型；无法识别时
保留不带 charset 的 `application/octet-stream`。

## 所有权

- `internal-portal-collection` 写 source bucket，并在必需资源齐备后登记通知与来源映射；
- `notice-classifier` 读取数据库中的 ID 与标题，并更新同一行的 `category`；
- `notice-publisher` 读取数据库中的待发布项、校验来源、写 derived 图片和正文并设置 `is_published`；也可重新读取已发布通知
  的 source，更新 `content_html` 和 `content_text` 而保持已发布状态；
- `notice-index-publisher` 在显式本地或默认暂停的集群任务中以只读快照读取已发布正文；集群任务生成
  derived bucket 中内容寻址的 Chunk Run 与 Embedding Set，本地任务继续生成问题集与评测制品；它不更新
  通知数据库、source bucket、Qdrant 或在线索引绑定。统一 `retrieval-index` 读取这些显式
  制品并负责混合 collection 与 current pointer；
- App API 只获得五张通知业务表的读取权限，并读取获准图片对象；不读取 migration ledger 或写入通知；
- Campus Web 只通过 App API 读取规范化通知；
- Ops Web 拥有内部门户凭据，并只读取通知安全 metadata、更新 `category`；agent-control、Agent 与
  在线检索消费者不连接通知来源或 schema，统一 publisher 也只读取 immutable Notice artifacts，不连接
  live Notices DB。

通知 publisher 提供独立 CLI，并由 `notice-pipeline-worker` 调用同一实现完成自动或手动发布；
制品构建由 `retrieval-index build` 执行，索引应用由独立 Apply Job 按显式输入运行。schema 由统一迁移 Job 安装，
发布流程不执行 DDL。调度和运行凭据见[采集运行](../runbooks/ingestion/ingestion.md)。阶段间只交接显式制品 ID；只有统一
Publisher 成功验证并激活 `campus_docs_serving.current_index` 后，Notice 才通过 `campus_search` 进入
在线检索。本地模型比较结果和对象存储中存在制品都不表示已经完成该发布。

## 相关文档

- [通知](../architecture/domains/notices.md)
- [通知接口](../contracts/app-api/notices.md)
- [采集运行](../runbooks/ingestion/ingestion.md)
- [内部门户通知来源合同](../../.agents/notes/implemented/architecture/2026-08-14-internal-portal-notice-source.md)
- [规范化通知存储](../../.agents/notes/implemented/architecture/2026-08-14-normalized-notice-storage.md)
- [通知维护状态收敛](../../.agents/notes/implemented/architecture/2026-08-25-notice-maintenance-state.md)
- [Notice Chunk、Embedding 与本地评测](../../jobs/notice-index-publisher/README.md)
