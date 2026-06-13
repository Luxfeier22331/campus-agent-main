---
doc_type: reference
truth_scope: ops
owner_boundary: docs/reference/archive/incidents
status: historical
created: 2026-04-12
updated: 2026-04-20
---
# Provider `/responses` 接口契约异常问题报告（2026-04-12）

## Historical Note

本文只保留 `2026-04-12` 针对 `su8` OpenAI-compatible `/responses` 端点异常的历史 incident 摘要。
当前 supplemental provider 已切换，原问题不再是 active blocker。

## Retained Meaning

- 历史异常现象是：`POST /responses` 返回 HTTP `200` 且 `status=\"completed\"`，但没有可消费输出
- 这份旧报告的价值在于保留当时的 provider 契约失败结论，而不是继续维护完整复现脚本与逐轮 response 记录

## Current Canonical Entry

- `docs/architecture/prompt-and-instruction-architecture.md`
- `docs/environment/provider-and-secret-inventory.md`
- `docs/runbooks/provider-secret-governance.md`

如需完整旧正文，请通过 git history 追溯。
