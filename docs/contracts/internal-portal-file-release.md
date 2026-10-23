---
doc_type: contract
owner_boundary: sources/internal-portal
status: active
---

# 内部门户文件发布采集

## 边界

internal-portal-collection 分页扫描门户文件发布库存，按 ID 保存原始文件和来源 metadata。当前不生成
通用 ingestion task；集群由通知工作流的 `file-sync` mode 调用该实现，不执行 PDF 解析、OCR、
正文抽取、清洗、分类、索引或在线发布。

## 入口语义

本地采集使用受管理环境中的直接 TGC，集群 Worker 或显式 Job 先通过 Ops Web 解析可用 TGC。各入口执行
同一 `file-sync` 实现，分页、复用、对象写入和失败语义一致。具体操作见
[采集与发布手册](../runbooks/ingestion/ingestion.md)。

## 分页与失败

列表接口每页请求 50 条，ID 必须是唯一正整数，累计数量必须与门户返回的 total 一致。采集按 ID
顺序逐条处理：

- 已有合法 `source.json`：计为 `reused`，不访问门户；
- 首次成功写入：计为 `written`；
- 普通单项失败：记录 ID 和有界错误码，继续后续条目，整轮最终非零退出；
- 认证失败：立即终止整轮。

摘要字段为 `scanned`、`written`、`reused`、`failed` 和 `failures`。

## 对象语义

每个文件发布 ID 对应原始下载字节和一份 `source.json`。`source.json` 使用
`internal_portal_file_release_source.v1`，保存门户 metadata、原始文件名、media type、字节数、SHA-256
摘要和对象 key。首次成功采集确定固定对象；同 key 内容冲突明确失败。具体对象布局由
[内部门户数据](../data/internal-portal.md)维护。

## 所有者

- 门户适配、分页和对象写入：`jobs/internal-portal-collection`；
- 凭据解析：`apps/ops-web` 的内部解析接口；
- 来源对象合同：`packages/ingestion-contracts`。

## 相关文档

- [内部门户数据](../data/internal-portal.md)
- [采集运行](../runbooks/ingestion/ingestion.md)
- [内部门户认证](../runbooks/access/portal-auth.md)
