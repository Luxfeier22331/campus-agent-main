---
doc_type: index
owner_boundary: docs/postmortem
status: active
---

# 事故复盘

仅为机制隐蔽、暴露测试／工具／流程缺口且重新发现成本高的真实故障写复盘，不要求每个 bug 都记录。
本分区解释故障经过与漏检原因；长期选择及理由由[决策笔记](../../.agents/notes/README.md)维护，二者互链。
实现和操作步骤链接到所属代码、测试或操作文档，不复制它们的当前合同。

## 写作规则

- 文件名用 `NNNN-topic.md`，编号递增；正文依次为摘要、影响、经过、根因、为什么检查没发现、修复与回归验证、长期教训。
- 摘要交代故障、根因、漏检原因和改进；经过只写可确认的事件，区分事实与推测，不补造时间或生产影响。
- 使用 `doc_type: reference`、`owner_boundary: docs/postmortem`、`status: active`；解决情况写正文。
  active 表示文档仍有效，不表示事故未解决。修复与验证须链接真实实现或测试，不把未完成措施写成已完成。
- 复盘不新增强制章节门禁；普通 frontmatter、链接、语言检查适用。

## 已记录案例

- [0001 归档命令失效，却被报告为已完成](./0001-note-archive-false-completion.md)
