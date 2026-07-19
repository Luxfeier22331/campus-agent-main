---
doc_type: domain
owner_boundary: domains/source-card
status: active
---

# 来源卡片

## 边界

来源卡片把回答中已经校验的依据连接到文档阅读器。问答、文档搜索和直接阅读使用同一文档身份、
版本和章节位置，使用户可以从回答进入原文并返回当前任务。

来源卡片只包含用户可见标题、摘要、版本和阅读目标，不包含检索轨迹、分块内部标识、对象存储
位置、供应商分数或正文载荷。

## 行为

- 当前版本链接进入当前已发布文档，历史依据必须明确进入对应历史版本；
- 章节锚点是稳定导航位置，重新分块或更换搜索实现不能改变其含义；
- 高亮只帮助定位本次依据，不成为文档或段落身份；
- 依据缺少可交付阅读目标时不能生成虚构链接；
- 阅读权限由 App API 判定，来源卡片不能扩大用户可见范围。

精确 HTTP 字段和 URL 结构由文档阅读器合同维护，逻辑标识由文档阅读器数据模型维护。

## 相关文档

- [App API 文档接口](../contracts/app-api/document-reader.md)
- [文档阅读器数据](../data/document-reader.md)
- [执行合同](../contracts/tool-execution.md)
- [文档站架构](../architecture/system/document-site.md)
