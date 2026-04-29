# Quick Task 260414-ang Research

**Description:** 冻结已采集 regulation corpus 的离线 inventory 与 blocked frontier  
**Mode:** quick-full

## Repo Facts

- 当前本地 regulation 相关 source snapshot 固定来自：
  - `.tmp/historical-intake/run14-policy-regulation-expanded/local-smoke/registry/source-truth-inventory.json`
  - `.tmp/historical-intake/run14-policy-regulation-expanded/local-smoke/registry/documents.json`
- 这份 snapshot 当前稳定覆盖 `16` 条已采集 notice family。
- formal local current target 当前已稳定 materialize `11` 条 regulation。
- `355282` 已完成 bounded repair，并已作为 attachment-backed regulation 并入当前 formal local current target。
- `351119` 仍受 auth-window `file_release` capture 阻塞。

## Decision

当前认证失效后，最有价值的非认证任务不是重复 chunk prep，而是冻结一份 offline inventory：

- 明确哪些 regulation 已可直接消费
- 明确哪些仍是 duplicate/source hold
- 明确哪些是 auth-blocked frontier
- 明确哪些已采集但不属于 regulation 当前导入线
