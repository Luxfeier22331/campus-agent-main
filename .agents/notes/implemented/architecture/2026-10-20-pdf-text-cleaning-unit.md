# Agent Note: PDF 文本清洗单元

Status: implemented

## 背景

[通知 PDF 附件进入检索](./2026-10-20-notice-pdf-attachment-retrieval.md)要求把附件 OCR 文本送进
v10 分块。直接分块存在两个问题：

- 现有分块器 `buildNoticeChunks`（`jobs/notice-index-publisher/src/chunking/index.ts`）只吃字符串，
  其标题、字段、列表和表格识别基于清洗后的通知正文文本；Paddle 页输出是 provider 原生 Markdown/HTML，
  含 HTML `<table>` 块、转义换行与图片引用（`packages/document-ocr/test/store.integration.test.ts` 的
  样例为 `"<table>…</table>"`），与分块器期望的输入形态不同。
- 这条链路的缺口不止 PDF：正文图片 OCR 文本在 `jobs/notice-index-publisher/src/source.ts`
  里只剥离图片引用（`![]()` 与 `<img>`），`<table>` HTML 原样进入 `contentText` 喂给 v10。
  图片消费笔记（2026-10-02）把 provider 表格文本的换行与箭头转换只放在渲染树
  （`apps/ops-web/src/app/ocr-table-text.ts`），明确不修改数据库 Markdown、不改变 embedding 来源
  文本——因此图片路径实际一直把 HTML 表格当普通文本行分块，列结构丢失，v10 的
  `detectDelimitedTable`（分号分隔）认不出 HTML 表格。这是图片路径既有的分块债。

## 决策

清洗既不属于 OCR 存储（`document-ocr` 负责产出并保存逐页结果），也不属于分块
（`notice-index-publisher` 负责分块与制品），更不是独立 job——清洗是确定性纯函数，无外部调用、
无状态、无失败面、无调度需求，套上 job 生命周期只制造无人消费的部署与持久化边界。
「HTML → 通知同构文本」抽成独立共享单元，单独定义 owner、输入输出与边界。

### 共享包 `packages/text-normalization/`

从 `packages/domains/notices/src/` 抽出无门户语义的 HTML → 结构化文本核心：

- `deriveStructuredText`（去标签、保留 `BR` 与块边界、空白归一）；
- `serializeLogicalTable` 及其网格逻辑（rowspan/colspan 网格、THEAD/TBODY 行收集、逻辑行序列化）；
- `sanitizeHtml` / `sanitizeChildren`：JSDOM 解析与通用白名单清洗（移除注释、脚本、样式、表单、
  iframe；非白名单标签解包）。

表格序列化输出分号连接行（`"A；B\nC；D"`、`"类别：讲座；时间/开始：9:00"`），正是 v10
`detectDelimitedTable` 认的格式。`normalizeNoticeContent` 继续使用同一核心（notices 包改为
re-export），门户语义（图片 URL 归一化、`notice-asset` 重编号、`safeLink`、presentation、
通知错字修正）留在 `@campus-agent/notices`。DOM 遍历用 jsdom 支撑（保真优先）。

### 边界

- 清洗单元的职责：输入一页或多页 provider 页文本，输出可交给通知 v10 分块器的清洗后文本。
- 不拥有 OCR 存储：`ocr.pages.markdown` 仍是 provider 输出，`document-ocr` 不改变其写入/读取语义，
  Ops 逐页查看的仍是原始结果。
- 不拥有分块：清洗后文本如何分块仍由 v10 定义决定。
- 不拥有来源关系：附件 → 通知的身份仍由 `notice-index-publisher` 的装配与 point 身份决定。

调用链为：`document-ocr` 产出页 →（共享清洗核心）→ `notice-index-publisher` 装配步分块。

### 装配步调用（`notice-index-publisher/src/source.ts`）

清洗在装配步执行，不在 `document-ocr` 落页时执行。三个来源统一走清洗核心：

```text
content_text    → 已由 publisher 清洗，直接进分块
image_text      → 逐图、逐页经清洗核心，剥离图片引用
attachment_text → 逐附件、逐页经清洗核心，剥离图片引用
```

- `notice-index-publisher` 依赖 `@campus-agent/text-normalization`，并照 `document-ocr` 先例把
  jsdom 声明为直接生产依赖、构建 `--external:jsdom`；`retrieval-index` 因引用同一来源装配同样处理。
- 图片路径的 HTML 表格债随之消除：清洗后表格输出 `；` 连接行，命中 v10 `detectDelimitedTable`，
  列结构保进 chunk 与 `retrievalText`——三来源在分块前形态一致。

### 细节约束

- **按页清洗**：逐页清洗再按页序拼接，避免把跨页不闭合的 HTML 片段合并后交给解析器。
- **标题参数**：清洗核心不做重复标题移除（那是通知门户语义），PDF 页不存在标题重复问题。
- **附件分隔**：多附件之间由装配层的聚合顺序（附件 ordinal）分隔。
- **图片引用剥离**：PDF 页内图片引用（`results.ts` 落成 `images/<page>-<idx>`）不作为文本输入，
  与正文图片一致地剥离。

## 未采用方案

### 做成独立 job

清洗是纯函数，无外部调用、无状态、无失败面、无调度需求。独立 job 引入部署、调度、重试、失败面与
持久化边界，没有第二消费者。除非将来清洗引入模型调用（LLM 改写/纠错），才需要重新评估——
那是重新评估条件，不是当前设计前提。

### 在 `document-ocr` 落页时清洗

`ocr.pages` 目前是 provider 原生结果，Ops 逐页查看与既有页面迁移/清理都基于该语义；在此改写等于
改变 OCR 存储合同并需要回填历史页。jsdom 依赖虽已就位，但「改存储语义」正是本设计要避开的。

### 在 `notice-index-publisher` 内联整体 `@campus-agent/notices`

让制品构建器背一整个门户领域包（jsdom 之外还拉进图片 URL、presentation、错字修正等无关逻辑），
与「抽核心、不杂糅」的目标冲突。

### 为 PDF 另写一套清洗规则

与通知正文清洗分叉，产生两套文本修正、标签白名单与表格规则；真实 PDF 与通知正文往往描述同一制度，
分叉会带来不一致的分块预输入。

## 后果

- 同一页 provider 文本经清洗核心得到的文本形状与通知 `content_text` 一致：标签、表格逻辑行与
  空白规则遵循现有 notices 语义；抽取是行为不变的重构，notices 包 21 项测试全绿。
- 图片 OCR 文本经清洗后，HTML 表格转为分号连接行，v10 的 `detectDelimitedTable` 可识别，列结构
  保留；图片路径的分块债消除。图片 OCR 文本的 embedding 因此变化（更正确），需要重新发布索引。
- `ocr.pages.markdown` 与 Ops 逐页查看输出不变；公开通知接口输出不变。
- 清洗核心被替换或调整时，分块器与 OCR 存储都不需要改动。
- `notice-index-publisher` 与 `retrieval-index` 的镜像新增 jsdom 生产依赖（bundle external、
  运行镜像安装），与 `document-ocr` 既有先例一致。
- 真实 PDF（扫描页、复杂表格、多级标题）经清洗后能否被 v10 正确识别已在本地端到端验证中确认
  （见[附件通路笔记](./2026-10-20-notice-pdf-attachment-retrieval.md)的验证记录）：真实 Paddle
  输出的 163 个含 `<table>` 页清洗为 `；` 逻辑行，457 chunk 无 HTML/图片引用残留；v10 的
  `headingLevel` 只识别中文编号标题，PDF 层级若表现为 HTML `<h*>` 仍可能不被识别为 heading，
  该覆盖缺口由线上验收继续观察。
- 定向样本验证（2026-10-21）发现并修复两个清洗缺口：表格单元格内的字面 `\n` 转义（provider
  两字符输出，非真实换行）在 `normalizeTableCellText` 中规范为空格；Paddle 行首 markdown 标题
  标记（`#`/`##`，含超界 `#######`）在 `cleanOcrText` 剥离——不剥离则 v10 的编号标题检测全部
  失效，34 个通知的标题结构因此恢复。全语料复验 12,276 chunk 无 markdown 标记残留。
