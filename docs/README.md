---
doc_type: index
status: active
created: 2026-03-22
updated: 2026-03-22
---

# Docs

`docs/` 只保留稳定文档标识，不把创建日期放进文件名。

## 分类

- `architecture/`: 长期边界、职责划分、系统形态
- `decisions/`: 已接受的决策记录，使用稳定 ADR 编号
- `plans/`: 可执行实施文档

## 标识规则

- `architecture` 和 `plans` 使用语义 slug，例如 `long-term-architecture.md`
- `decisions` 使用 `adr-NNNN-<slug>.md`
- 日期进入 YAML front matter，不作为文件名主标识

## Metadata

所有 canonical 文档在顶部使用 YAML front matter。

- `doc_type`: `index`、`architecture`、`decision`、`plan`
- `status`: `active`、`accepted`、`archived`、`superseded`
- `created`: 文档首次建立日期
- `updated`: 最近一次实质内容更新时间
- `decision_id`: 仅 decision 文档必填

## Canonical Docs

- `architecture/long-term-architecture.md`
- `architecture/phase1-ingestion-and-storage-architecture.md`
- `decisions/adr-0001-phase1-architecture.md`
- `decisions/adr-0002-local-minio-conventions.md`
- `plans/agentic-rag-foundation.md`
