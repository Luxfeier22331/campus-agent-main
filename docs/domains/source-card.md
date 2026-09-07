---
doc_type: domain
owner_boundary: domains/source-card
status: active
---

# 来源卡片

## 边界

来源卡片把回答实际引用且已经校验的结果连接到站内文档、校园通知或公开网页。问答、文档搜索和直接阅读
使用稳定来源身份和章节位置，使用户可以从回答进入原文并返回当前任务。Campus Docs 来源进入固定版本的
文档阅读器；校园通知进入 `/notices/<noticeId>` 站内页面；公开网页来源进入 Finalization 校验过的
HTTP/HTTPS 页面。

来源卡片只包含用户可见引用编号、标题、摘要、阅读目标，以及 Campus Docs 的版本信息、Notice 身份或
网页 hostname，不包含检索轨迹、分块内部标识、对象存储位置、供应商分数、搜索结果正文或供应商载荷。

## 行为

- 问答来源只使用本轮当前索引中的文档版本，但链接始终固定为 `/v/<versionSlug>`；当前版本同时保留
  普通导航 URL 和该版本 permalink，后续默认版本变化不能改写历史回答的阅读目标；
- 章节锚点是稳定导航位置，重新分块或更换搜索实现不能改变其含义；
- 高亮只帮助定位本次依据，不成为文档或段落身份；
- 依据缺少可交付阅读目标时不能生成虚构链接；
- Campus Docs 卡片只能链接到 Campus Web 已发布的公开阅读目标；Campus Notice 卡片只能链接到校内
  `/notices/<noticeId>` 阅读目标；网页卡片保留经过校验的完整 HTTP/HTTPS URL，并在新标签页打开；
- 卡片保存 Campus Docs 的 `versionSlug`，由消费界面生成“2026 年版”或“第 1 版”等显示文本，不展示
  “现行版”。
- `citationIndexes` 保留正文首次引用该来源的顺序；同一来源多次被引用时合并为一个卡片并稳定去重。
- `citationIndexes` 只能包含正整数且不得重复；产品层不根据正文重新生成或重新排序编号。
- Web 来源按完整 URL 去重，query 或 fragment 不同的 URL 是不同来源。
- 服务端保存完整来源集合；Campus Web 默认展示前五项，并允许用户展开或收起其余来源。

Campus Docs 的交付字段和 URL 结构由文档来源与静态交付合同维护，逻辑标识由文档阅读器数据模型
维护；Web 来源字段由执行合同维护。来源卡片只能投影本轮已校验 evidence，不能选择索引、版本或
扩大检索输入。

## 相关文档

- [文档来源与静态交付合同](../contracts/document-reader-delivery.md)
- [文档阅读器数据](../data/document-reader.md)
- [执行合同](../contracts/tool-execution.md)
- [文档站架构](../architecture/system/document-site.md)
