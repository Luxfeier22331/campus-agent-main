---
doc_type: contract
owner_boundary: sources/internal-portal
status: active
---

# 内部门户文件发布采集

## 边界

internal-portal-collection 分页扫描门户文件发布库存，按 ID 保存原始文件和来源 metadata。当前不生成
ingestion task 或 workflow，不执行 PDF 解析、OCR、正文抽取、清洗、分类、索引或在线发布。

## 入口

```bash
pnpm internal-portal:collect -- --mode file-sync
kubectl -n <namespace> create job \
  --from=cronjob/file-sync <job-name>
```

本地入口使用受管理环境中的直接 TGC。Job 入口先调用 Ops Web 解析可用 TGC，再执行相同
实现。Kubernetes base 中的 `file-sync` 是默认暂停的完整模板；维护者显式创建一次性
Job，不启用 schedule。

## 分页与失败

列表接口每页请求 50 条，ID 必须是唯一正整数，累计数量必须与门户返回的 total 一致。采集按 ID
顺序逐条处理：

- 已有合法 `source.json`：计为 `reused`，不访问门户；
- 首次成功写入：计为 `written`；
- 普通单项失败：记录 ID 和有界错误码，继续后续条目，整轮最终非零退出；
- 认证失败：立即终止整轮。

摘要字段为 `scanned`、`written`、`reused`、`failed` 和 `failures`。

## 对象

```text
internal_portal/<site-id>/file-releases/<file-release-id>/file
internal_portal/<site-id>/file-releases/<file-release-id>/source.json
```

`file` 是原始下载字节。`source.json` 使用 `internal_portal_file_release_source.v1`，保存门户 metadata、
原始文件名、media type、字节数、SHA-256 摘要和对象 key。首次成功采集确定固定对象；同 key 内容冲突
明确失败。

## 所有者

- 门户适配、分页和对象写入：`jobs/internal-portal-collection`；
- 凭据解析：`apps/ops-web` 的内部解析接口；
- 来源对象合同：`packages/ingestion-contracts`。

## 相关文档

- `docs/data/internal-portal.md`
- `docs/runbooks/ingestion.md`
- `docs/runbooks/portal-auth.md`
