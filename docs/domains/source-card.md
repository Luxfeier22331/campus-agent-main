---
doc_type: domain
owner_boundary: domains/source-card
status: active
---
# 来源卡片

本文统一说明问答与文档阅读器中来源卡片的 permalink、anchor 和 highlight 行为。

## 边界

来源卡片由已选 supporting evidence 生成，是可交付浏览器的引用目标。问答答案、文档搜索结果
和直接阅读入口必须落到同一 reader permalink。

来源卡片不是：

- 原始 retrieval trace；
- 原始 chunk id 或 source unit key；
- object storage key；
- provider score 或 debug payload；
- reader content payload。

## 消费结构

共享结构为：

```text
回答证据 + 规范引用
  -> 来源卡片
  -> /docs/:corpus/:collection/:docSlug?hl=<rootUnitId>#<anchor>
```

固定规则：

- assistant 正文只包含答案，不拼接序列化引用字段；
- 来源卡片携带 canonical document title、可选 section title、snippet、version label 与 reader
  target；
- `canonicalUrl` 保留旧 wire 字段名，但语义是 reader permalink，不是 SEO canonical URL；
- `anchor` 是稳定跳转目标；
- `highlightRootUnitIds[]` 是稳定的临时高亮目标。

## Reader 路径

reader permalink 语义：

- 当前版本：`/docs/:corpus/:collection/:docSlug`；
- 指定版本：`/docs/:corpus/:collection/:docSlug/v/:versionSlug`；
- section 跳转：`#<anchor>`；
- 临时高亮：`?hl=<rootUnitId1>,<rootUnitId2>`。

`anchor` 与 `rootUnitId` 来自 canonical document unit，不得根据当前 chunk id 或 vendor result
id 派生。

## 所有者文档

- Browser/docs control-plane 字段：`../contracts/app-api/document-reader.md`；
- canonical reader model：`../data/document-reader.md`；
- knowledge evidence 与 final source 合同：`../contracts/tool-execution.md`；
- indexed retrieval serving 边界：`../architecture/system/retrieval-serving.md`；
- docs reader 架构：`../architecture/system/document-site.md`。

上述文档拥有各自机器合同与数据模型；本文只拥有来源卡片导航的人类可读行为规则。
