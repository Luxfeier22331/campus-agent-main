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

- 问答来源只使用本轮当前索引中的文档版本，但链接始终固定为 `/v/<versionSlug>`；当前版本同时保留
  普通导航 URL 和该版本 permalink，后续默认版本变化不能改写历史回答的阅读目标；
- 章节锚点是稳定导航位置，重新分块或更换搜索实现不能改变其含义；
- 高亮只帮助定位本次依据，不成为文档或段落身份；
- 依据缺少可交付阅读目标时不能生成虚构链接；
- 来源卡片只能链接到 Campus Web 已发布的公开阅读目标。
- 卡片显示 source manifest 中的真实版本标签，不根据查看时的当前版本推导“现行版”。

交付字段和 URL 结构由文档来源与静态交付合同维护，逻辑标识由文档阅读器数据模型维护。来源卡片
只能投影本轮已校验 evidence，不能选择索引、版本或扩大检索输入。

## 相关文档

- [文档来源与静态交付合同](../contracts/document-reader-delivery.md)
- [文档阅读器数据](../data/document-reader.md)
- [执行合同](../contracts/tool-execution.md)
- [文档站架构](../architecture/system/document-site.md)
