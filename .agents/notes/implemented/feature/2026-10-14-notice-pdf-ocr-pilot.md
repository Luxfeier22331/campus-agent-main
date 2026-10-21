# Agent Note: 通知 PDF 附件 OCR 试点

Status: implemented

## 背景

通知采集已经把正文图片和附件原始字节保存到 source bucket。正文图片 OCR 已使用独立任务和逐页结果，但 PDF 附件尚未进入 OCR 选择器。PDF 消费试点需要先确认真实附件的逐页文本和页面图片质量，再决定是否接入通知检索。

## 决策

PDF 附件沿用现有 `OcrInput`、`ocr.tasks` 和 `ocr.pages`，每个 PDF 创建一个多页 OCR 任务。任务输入保留通知 ID、附件 ordinal、source key 和 `application/pdf` 类型；结果按连续页序保存。首轮通过 `document-ocr` CLI 扫描真实通知，Ops 复用现有结果投影和逐页 Markdown 查看器展示附件任务。PDF OCR 文本本轮不写回通知正文，也不进入 chunk 或 embedding。

正文图片和 PDF 附件在任务列表与通知级投影中按资源类型区分，附件显示为 PDF 资源；图片既有接口和发布行为保持不变。

## 未采用方案

本轮不把 PDF 内页提升为通知正文图片资产，因为页面图片属于 PDF 页面结果，尚未证明需要独立正文资源语义。

本轮不新增 PDF 专用任务表或第二套内容拆分算法，因为现有页级 OCR 结果已经能保存、导出和查看。

本轮不直接接入检索，因为需要先通过代表性 PDF 验收文字、扫描页、表格和页面图片质量。

## 后果

CLI 可以扫描 source 中后缀为 PDF 的附件；Ops 可以列出附件任务并复用逐页结果弹窗。后续检索若接入，应以附件 ordinal 和页码保留来源关系，再交给现有通知 chunker 处理。首轮试点仍需要人工用真实 PDF 验收 OCR 质量。
