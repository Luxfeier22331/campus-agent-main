# Text Normalization

共享的「HTML → 结构化文本」核心：白名单清洗、块边界与 `BR` 换行、表格逻辑行序列化
（rowspan/colspan 网格）与空白归一。门户通知正文清洗（`@campus-agent/notices`）与通知索引的
OCR 文本清洗（`notice-index-publisher` 装配步）共用同一实现，不复制第二套规则。

## 边界

- 输入是 HTML 片段（含 provider 输出的 `<table>` 等标记），输出是与通知 `content_text` 同构的
  纯文本；表格序列化为 `；` 连接的逻辑行，可被通知分块器的表格识别消费。
- 本包不拥有门户语义：图片 URL 归一化、`notice-asset` 重编号、链接安全化、通知错字修正与
  presentation 映射留在 `@campus-agent/notices`。
- 本包不拥有 OCR 存储或分块：`ocr.pages` 仍保存 provider 原始输出，分块定义仍由
  `notice-index-publisher` 维护。

## API

- `htmlToStructuredText(html)`：解析 + 白名单清洗 + 文本派生的便利封装。
- `sanitizeHtml(html)` / `sanitizeChildren(element)`：JSDOM 解析与通用白名单清洗
  （移除注释、脚本、样式、表单、iframe；非白名单标签解包）。
- `deriveStructuredText(root, NodeCtor)`：已清洗 DOM → 结构化文本。
- `serializeLogicalTable(table, NodeCtor, deriveText)`：表格 → 逻辑行。

标签白名单与单元格跨度上限来自 `campus-contracts/notices`，与通知正文合同共用同一清单。
