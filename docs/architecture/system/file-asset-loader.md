---
doc_type: architecture
truth_scope: data
owner_boundary: docs/architecture/system
status: active
created: 2026-04-19
updated: 2026-07-06
---
# Shared File Asset Loader Boundary

## 文档边界

本文只冻结 repo 级 file-like asset handling 的边界和重新接入要求。

它不记录旧 Python package、旧 Java conversion service 或某个 OCR provider 的
runtime 操作步骤；这些实现已经退出 active workspace。

## 当前状态

旧 Python ingestion package、legacy Office conversion service、OOXML 验证脚本和
相关测试已经清退。当前 active workspace 没有默认 file asset loader runtime。

OCR、MinerU、Paddle、Office conversion 或其他 file extraction 能力后续如果重新接入，
必须作为以下形态之一重新 admission：

- `apps/ingestion-control` 的显式 TS handler 调用 private adapter service
- deterministic Rust kernel
- 窄范围 adapter package，且只能被显式 TS handler 调用

不得恢复旧 Python package 作为 default worker、fallback executor、provider client owner、
source-truth mutation owner 或 registry owner。

## Canonical Boundary

file-like asset handling 只能位于 source-specific source truth 已成立之后：

```text
source-truth relation or file descriptor
-> optional normalization
-> extraction/provider artifacts
-> terminal outcome or canonical child document artifacts
```

固定规则：

- source unit 继续由 source channel 定义；`official_web` 是 page-level
  source truth，`internal_portal` 是 notice-level source truth
- shared file asset handling 不替代 collector、source-truth materializer、
  document registry、chunk/index release 或 serving alias publish
- provider output 必须转成 repo-owned canonical artifacts / document units 后才能被下游消费
- 任何 lane 无法高置信完成时必须 fail closed 到 repo-owned terminal outcome
- remote API 与 self-hosted service 只是 deployment mode，不是新的 data-plane layer

## Re-Admission Rules

重新接入 OCR / file extraction 时，必须同一变更内落地：

- input / output contract
- explicit handler 或 kernel bridge
- object-store artifact refs
- failure taxonomy and terminal outcome
- verification lane
- operator-safe closeout projection

禁止只增加 provider env、enum、profile 字段、registry 占位或兼容 shim。

## 相关稳定文档

- `docs/architecture/system/data-plane.md`
- `docs/architecture/system/python-boundaries.md`
- `docs/architecture/domains/authenticated-notice/architecture.md`
- `docs/architecture/domains/official-web/architecture.md`
